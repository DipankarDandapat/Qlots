import React, { useCallback, useEffect, useRef, useState } from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';
import {
  ActivityIndicator, Animated, Dimensions, KeyboardAvoidingView, Modal, Platform, Pressable,
  RefreshControl, ScrollView, StatusBar, StyleSheet, Text, TextInput, View,
} from 'react-native';
import Svg, { Circle, Path, Polyline, Rect } from 'react-native-svg';
import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import QlotsLogo from './QlotsLogo';

// ── API Logger (Chucker-style) ────────────────────────────────────────────────
const apiLogs = [];
let apiLogListeners = [];
function addLog(entry) {
  apiLogs.unshift(entry);
  if (apiLogs.length > 100) apiLogs.pop();
  apiLogListeners.forEach(fn => fn([...apiLogs]));
}
function useApiLogs() {
  const [logs, setLogs] = useState([...apiLogs]);
  useEffect(() => {
    apiLogListeners.push(setLogs);
    return () => { apiLogListeners = apiLogListeners.filter(f => f !== setLogs); };
  }, []);
  return logs;
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let showToastFn = null;
function useToastController() {
  const [toast, setToast] = useState(null);
  const timerRef = useRef(null);
  showToastFn = (msg, type = 'error') => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast({ msg, type });
    timerRef.current = setTimeout(() => setToast(null), 3500);
  };
  return toast;
}
function showToast(msg, type = 'error') { if (showToastFn) showToastFn(msg, type); }
function Toast({ toast }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(anim, { toValue: toast ? 1 : 0, useNativeDriver: true }).start();
  }, [toast]);
  if (!toast) return null;
  const bg = toast.type === 'error' ? '#A6473C' : toast.type === 'success' ? '#176B4D' : '#416F8B';
  return (
    <Animated.View style={[styles.toast, { backgroundColor: bg, opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }] }]}>
      <Text style={styles.toastText}>{toast.msg}</Text>
    </Animated.View>
  );
}

const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://qlots.onrender.com').replace(/\/$/, '');
const C = { ink: '#17251F', muted: '#728078', canvas: '#F5F6F0', card: '#FFFFFF', green: '#176B4D', deep: '#123D2E', mint: '#DFF1E8', lime: '#C8E8A9', gold: '#F2C66D', border: '#E4E9E2', red: '#A6473C', redBg: '#FCEDE9', blue: '#416F8B' };
const money = (value = 0, compact = false) => {
  const n = Number(value || 0);
  if (compact && Math.abs(n) >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (compact && Math.abs(n) >= 100000) return `₹${(n / 100000).toFixed(2)} L`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
};
const labelize = (value = '') => value.replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());

// Returns "MMM YYYY" e.g. "Jul 2026" given an ISO date string and years to add
const projDate = (isoDate, addYears) => {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  d.setFullYear(d.getFullYear() + addYears);
  return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
};
const CATEGORIES = {
  asset: ['cash', 'bank_balance', 'fixed_deposit', 'recurring_deposit', 'stocks', 'mutual_funds', 'etfs', 'property', 'gold', 'other'],
  liability: ['home_loan', 'personal_loan', 'car_loan', 'credit_card', 'education_loan', 'other_debt'],
  income: ['salary', 'business', 'rental', 'interest', 'other'],
  expense: ['housing', 'food', 'transport', 'health', 'education', 'utilities', 'entertainment', 'other'],
};

const SW = Dimensions.get('window').width;

// ── Pure-SVG chart helpers ────────────────────────────────────────────────────
function Sparkline({ data, width, height, color = C.lime }) {
  if (!data || data.length < 2) return null;
  const vals = data.map(d => d.net_worth);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 8) - 4;
    return `${x},${y}`;
  }).join(' ');
  const first = vals[0], last = vals[vals.length - 1];
  const trend = last >= first ? color : C.gold;
  // filled area path
  const ptsArr = vals.map((v, i) => [((i / (vals.length - 1)) * width), height - ((v - min) / range) * (height - 8) - 4]);
  const area = `M${ptsArr[0][0]},${height} ` + ptsArr.map(([x, y]) => `L${x},${y}`).join(' ') + ` L${ptsArr[ptsArr.length-1][0]},${height} Z`;
  return (
    <Svg width={width} height={height}>
      <Path d={area} fill={trend} fillOpacity={0.15} />
      <Polyline points={pts} fill="none" stroke={trend} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={ptsArr[ptsArr.length-1][0]} cy={ptsArr[ptsArr.length-1][1]} r={4} fill={trend} />
    </Svg>
  );
}

function DonutChart({ data, size = 140 }) {
  if (!data || !data.length) return null;
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total <= 0) return null;
  const COLORS = [C.green, C.blue, C.gold, '#9B6B9E', '#E07B54', '#5BA4A4', '#C8A96E', '#7B9E6B', '#A67B5B', '#6B8FA6'];
  const r = size / 2 - 14, cx = size / 2, cy = size / 2;
  let angle = -Math.PI / 2;
  const slices = data.slice(0, 6).map((d, i) => {
    const pct = d.value / total;
    const sweep = pct * 2 * Math.PI;
    const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
    angle += sweep;
    const x2 = cx + r * Math.cos(angle), y2 = cy + r * Math.sin(angle);
    const large = sweep > Math.PI ? 1 : 0;
    return { path: `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} Z`, color: COLORS[i % COLORS.length], pct, label: d.category };
  });
  return (
    <Svg width={size} height={size}>
      <Circle cx={cx} cy={cy} r={r + 2} fill="#1A3D2E" />
      {slices.map((s, i) => <Path key={i} d={s.path} fill={s.color} opacity={0.92} />)}
      <Circle cx={cx} cy={cy} r={r * 0.52} fill={C.deep} />
    </Svg>
  );
}

function HealthArc({ score, size = 90 }) {
  const r = size / 2 - 8, cx = size / 2, cy = size / 2;
  const circumference = Math.PI * r; // half circle
  const filled = (score / 100) * circumference;
  const color = score >= 75 ? C.lime : score >= 50 ? C.gold : '#E07B54';
  return (
    <Svg width={size} height={size / 2 + 10}>
      <Path d={`M${cx - r},${cy} A${r},${r} 0 0,1 ${cx + r},${cy}`} fill="none" stroke="#2A4A3A" strokeWidth={8} strokeLinecap="round" />
      <Path d={`M${cx - r},${cy} A${r},${r} 0 0,1 ${cx + r},${cy}`} fill="none" stroke={color} strokeWidth={8} strokeLinecap="round"
        strokeDasharray={`${filled} ${circumference}`} />
    </Svg>
  );
}

function CashFlowBar({ income, expenses }) {
  const total = income + expenses || 1;
  const incPct = income / total;
  const barW = SW - 36 - 32; // card padding
  return (
    <View>
      <View style={{ flexDirection: 'row', height: 10, borderRadius: 8, overflow: 'hidden', backgroundColor: C.redBg }}>
        <View style={{ width: barW * incPct, backgroundColor: C.green, borderRadius: 8 }} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.green }} />
          <Text style={{ color: C.muted, fontSize: 10 }}>Income {Math.round(incPct * 100)}%</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.red }} />
          <Text style={{ color: C.muted, fontSize: 10 }}>Expenses {Math.round((1 - incPct) * 100)}%</Text>
        </View>
      </View>
    </View>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

async function request(path, { method = 'GET', body, token, pdf = false } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const start = Date.now();
  const logEntry = { id: start, method, path, status: '...', ms: 0, time: new Date().toLocaleTimeString(), error: null };
  addLog(logEntry);
  try {
    const response = await fetch(`${API_URL}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    logEntry.status = response.status; logEntry.ms = Date.now() - start;
    addLog({ ...logEntry });
    if (!response.ok) {
      let message = `Request failed (${response.status})`;
      try { const data = await response.json(); message = data.detail || message; } catch (_) {}
      const err = new Error(message); err.status = response.status;
      logEntry.error = message; addLog({ ...logEntry });
      throw err;
    }
    if (pdf) return response.arrayBuffer();
    if (response.status === 204) return null;
    return response.json();
  } catch (e) {
    if (!logEntry.status || logEntry.status === '...') { logEntry.status = 'ERR'; logEntry.ms = Date.now() - start; logEntry.error = e.message; addLog({ ...logEntry }); }
    throw e;
  }
}

function Button({ title, onPress, secondary = false, small = false, disabled = false, style }) {
  return <Pressable disabled={disabled} onPress={onPress} style={[styles.button, secondary && styles.buttonSecondary, small && styles.buttonSmall, disabled && { opacity: 0.55 }, style]}><Text style={[styles.buttonText, secondary && styles.buttonTextSecondary, small && styles.buttonTextSmall]}>{title}</Text></Pressable>;
}
function Field({ label, value, onChangeText, placeholder, keyboardType = 'default', secureTextEntry = false, hint }) {
  return <View style={styles.fieldWrap}><Text style={styles.fieldLabel}>{label}</Text><TextInput value={value} onChangeText={onChangeText} placeholder={placeholder || ''} placeholderTextColor="#98A39C" keyboardType={keyboardType} secureTextEntry={secureTextEntry} autoCapitalize={keyboardType === 'email-address' ? 'none' : 'sentences'} style={styles.input} /><>{hint ? <Text style={styles.hint}>{hint}</Text> : null}</></View>;
}
function Card({ children, style }) { return <View style={[styles.card, style]}>{children}</View>; }
function SectionTitle({ title, action, onAction }) { return <View style={styles.sectionTitleRow}><Text style={styles.sectionTitle}>{title}</Text>{action ? <Pressable onPress={onAction}><Text style={styles.link}>{action}</Text></Pressable> : null}</View>; }
function Pill({ title, active, onPress }) { return <Pressable onPress={onPress} style={[styles.pill, active && styles.pillActive]}><Text style={[styles.pillText, active && styles.pillTextActive]}>{title}</Text></Pressable>; }
function Empty({ title, body }) { return <View style={styles.empty}><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.muted}>{body}</Text></View>; }

export default function App() {
  const toast = useToastController();
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [page, setPage] = useState('home');
  const [authMode, setAuthMode] = useState('login');
  const [auth, setAuth] = useState({ name: '', email: '', password: '' });
  const [dashboard, setDashboard] = useState(null);
  const [entries, setEntries] = useState([]);
  const [assumptions, setAssumptions] = useState({ salary_growth: '8', equity_return: '10', property_growth: '6', inflation: '5', monthly_investment: '0' });
  const [scenario, setScenario] = useState('base');
  const [forecast, setForecast] = useState(null);
  const [recordsTab, setRecordsTab] = useState('asset');
  const [flowTab, setFlowTab] = useState('income');
  const [modal, setModal] = useState(false);
  const [formKind, setFormKind] = useState('asset');
  const [form, setForm] = useState({ category: 'cash', name: '', amount: '', principal: '', annual_rate: '', frequency: 'monthly', emi: '', start_date: '', maturity_date: '', institution: '' });
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMsg, setLoadingMsg] = useState('Opening Qlots…');
  const [refreshing, setRefreshing] = useState(false);
  const [history, setHistory] = useState([]);
  const [editEntry, setEditEntry] = useState(null);
  const [profileModal, setProfileModal] = useState(false);
  const [profile, setProfile] = useState({ name: '', password: '' });
  const [showApiLog, setShowApiLog] = useState(false);
  const [healthInfoVisible, setHealthInfoVisible] = useState(false);
  const apiLogs = useApiLogs();

  const refresh = async activeToken => {
    const [dash, rows, assumptionsData, hist] = await Promise.all([
      request('/api/dashboard', { token: activeToken }),
      request('/api/entries', { token: activeToken }),
      request('/api/assumptions', { token: activeToken }),
      request('/api/history', { token: activeToken }),
    ]);
    setDashboard(dash); setEntries(rows); setHistory(hist);
    setAssumptions(Object.fromEntries(Object.entries(assumptionsData).map(([k, v]) => [k, String(v)])));
  };

  const handleSessionExpiry = useCallback(async () => {
    await SecureStore.deleteItemAsync('qlots-token');
    setToken(null); setUser(null); setDashboard(null); setEntries([]);
    showToast('Session expired. Please sign in again.', 'info');
  }, []);

  const safeRequest = useCallback(async (path, opts) => {
    try {
      return await request(path, opts);
    } catch (e) {
      if (e.status === 401) { handleSessionExpiry(); return null; }
      throw e;
    }
  }, [handleSessionExpiry]);

  useEffect(() => {
    (async () => {
      try {
        // Check server readiness
        setLoadingMsg('Connecting to server…');
        let serverReady = false;
        for (let i = 0; i < 3; i++) {
          try { await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(5000) }); serverReady = true; break; }
          catch (_) { setLoadingMsg(`Connecting to server… (attempt ${i + 2})`); await new Promise(r => setTimeout(r, 2000)); }
        }
        if (!serverReady) setLoadingMsg('Server slow to respond, continuing…');
        setLoadingMsg('Opening Qlots…');
        const saved = await SecureStore.getItemAsync('qlots-token');
        if (saved) {
          try {
            const refreshed = await request('/api/auth/refresh', { method: 'POST', token: saved });
            const newToken = refreshed.access_token;
            await SecureStore.setItemAsync('qlots-token', newToken);
            setUser(await request('/api/me', { token: newToken }));
            setToken(newToken);
            await refresh(newToken);
          } catch (_) {
            try {
              setUser(await request('/api/me', { token: saved }));
              setToken(saved);
              await refresh(saved);
            } catch (e) {
              if (e.status === 401) await SecureStore.deleteItemAsync('qlots-token');
            }
          }
        }
      } catch (_) { await SecureStore.deleteItemAsync('qlots-token'); }
      finally { setLoading(false); }
    })();
  }, []);

  const onPullRefresh = useCallback(async () => {
    if (!token) return;
    setRefreshing(true);
    try { await refresh(token); } catch (e) { if (e.status === 401) handleSessionExpiry(); }
    finally { setRefreshing(false); }
  }, [token, handleSessionExpiry]);

  const doAuth = async () => {
    if (!auth.email.trim() || !auth.password) return showToast('Enter your email and password.');
    if (authMode === 'register' && auth.password.length < 10) return showToast('Password must be at least 10 characters.');
    setBusy(true);
    try {
      const result = await request(authMode === 'register' ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body: authMode === 'register' ? auth : { email: auth.email, password: auth.password } });
      await SecureStore.setItemAsync('qlots-token', result.access_token);
      // Clear all previous user data before loading new user's data
      setDashboard(null); setEntries([]); setHistory([]); setForecast(null);
      setToken(result.access_token); setUser(result.user);
      try { await refresh(result.access_token); } catch (_) {}
    } catch (e) { showToast(e.message); }
    finally { setBusy(false); }
  };
  const signOut = async () => { await SecureStore.deleteItemAsync('qlots-token'); setToken(null); setUser(null); setDashboard(null); setEntries([]); setHistory([]); setForecast(null); setAnswer(''); setAuth({ name: '', email: '', password: '' }); setAuthMode('login'); };
  const openForm = kind => {
    setEditEntry(null);
    setFormKind(kind);
    setForm({ category: CATEGORIES[kind][0], name: '', amount: '', principal: '', annual_rate: '', frequency: 'monthly', emi: '', tenure_months: '', start_date: '', maturity_date: '', institution: '', growth_rate: '', notes: '' });
    setModal(true);
  };
  const openEdit = item => {
    setEditEntry(item);
    setFormKind(item.kind);
    setForm({
      category: item.category, name: item.name, amount: String(item.amount),
      principal: String(item.principal || ''), annual_rate: String(item.annual_rate || ''),
      frequency: item.frequency, emi: String(item.emi || ''),
      tenure_months: String(item.tenure_months || ''),
      start_date: item.start_date || '', maturity_date: item.maturity_date || '',
      institution: item.institution || '', growth_rate: String(item.growth_rate || ''),
      notes: item.notes || '',
    });
    setModal(true);
  };
  const saveEntry = async () => {
    if (!form.name.trim() || !form.amount) return showToast('Add a name and amount to continue.');
    const body = { kind: formKind, category: form.category, name: form.name.trim(), institution: form.institution, amount: Number(form.amount), principal: Number(form.principal || 0), annual_rate: Number(form.annual_rate || 0), frequency: form.frequency, emi: Number(form.emi || 0), tenure_months: Number(form.tenure_months || 0), start_date: form.start_date || null, maturity_date: form.maturity_date || null, growth_rate: Number(form.growth_rate || 0), notes: form.notes || '' };
    if (formKind === 'asset' && form.category === 'fixed_deposit' && (!body.principal || !body.start_date)) return showToast('Enter the original principal and start date for an FD.');
    setBusy(true);
    try {
      if (editEntry) {
        await request(`/api/entries/${editEntry.id}`, { method: 'PUT', body, token });
      } else {
        await request('/api/entries', { method: 'POST', body, token });
      }
      setModal(false); await refresh(token);
      showToast('Record saved.', 'success');
    }
    catch (e) { showToast(e.message); }
    finally { setBusy(false); }
  };
  const deleteEntry = id => {
    showToast('Tap again to confirm delete.', 'info');
    setTimeout(async () => { try { await request(`/api/entries/${id}`, { method: 'DELETE', token }); await refresh(token); showToast('Record deleted.', 'success'); } catch (e) { showToast(e.message); } }, 0);
  };
  const saveAssumptions = async () => {
    setBusy(true);
    try {
      const body = Object.fromEntries(Object.entries(assumptions).map(([k, v]) => [k, Number(v || 0)]));
      await request('/api/assumptions', { method: 'PUT', body, token });
      const data = await request(`/api/projection/calculate?scenario=${scenario}`, { method: 'POST', token });
      setForecast(data); await refresh(token); showToast('Projection updated.', 'success');
    } catch (e) { showToast(e.message); }
    finally { setBusy(false); }
  };
  const askHelper = async () => {
    if (!question.trim()) return;
    setBusy(true); setAnswer('');
    try { const result = await request('/api/ai/chat', { method: 'POST', body: { question }, token }); setAnswer(result.answer + '\n\n' + result.disclaimer); }
    catch (e) { showToast(e.message); }
    finally { setBusy(false); }
  };
  const makeReport = async () => {
    setBusy(true);
    try {
      const buffer = await request('/api/reports/pdf', { method: 'POST', token, pdf: true });
      const bytes = new Uint8Array(buffer); let binary = ''; for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = globalThis.btoa ? globalThis.btoa(binary) : null;
      if (!base64) throw new Error('This device cannot encode the report for sharing.');
      const uri = `${FileSystem.cacheDirectory}qlots-financial-report.pdf`;
      await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Share your Qlots report' });
      else showToast(`Report saved at ${uri}`, 'info');
    } catch (e) { showToast(e.message); }
    finally { setBusy(false); }
  };
  const runScenario = async next => {
    setScenario(next); setBusy(true);
    try { setForecast(await request(`/api/projection/calculate?scenario=${next}`, { method: 'POST', token })); }
    catch (e) { showToast(e.message); }
    finally { setBusy(false); }
  };
  const saveProfile = async () => {
    if (!profile.name.trim()) return showToast('Enter your name.');
    setBusy(true);
    try {
      const body = { name: profile.name.trim(), ...(profile.password ? { password: profile.password } : {}) };
      const updated = await request('/api/me', { method: 'PUT', body, token });
      setUser(updated); setProfileModal(false); setProfile({ name: '', password: '' });
      showToast('Profile updated.', 'success');
    } catch (e) { showToast(e.message); }
    finally { setBusy(false); }
  };
  const confirmDeleteAccount = () => {
    showToast('Tap “Delete everything” in profile to confirm.', 'info');
  };
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const doDeleteAccount = async () => {
    try { await request('/api/account', { method: 'DELETE', token }); await signOut(); }
    catch (e) { showToast(e.message); }
  };

  if (loading) return (
    <View style={styles.loading}>
      <QlotsLogo size={72} />
      <ActivityIndicator size="large" color={C.green} style={{ marginTop: 24 }} />
      <Text style={styles.muted}>{loadingMsg}</Text>
    </View>
  );
  if (!token) return <AuthScreen auth={auth} setAuth={setAuth} mode={authMode} setMode={setAuthMode} onSubmit={doAuth} busy={busy} toast={toast} />;

  const displayName = user?.name || 'Your finances';
  const shownEntries = page === 'records' ? entries.filter(e => e.kind === recordsTab) : page === 'cashflow' ? entries.filter(e => e.kind === flowTab) : [];

  return <View style={styles.app}>
    <StatusBar barStyle="dark-content" backgroundColor={C.canvas} />
    <Toast toast={toast} />
    <View style={styles.topbar}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><QlotsLogo size={38} /><View><Text style={styles.brand}>Qlots<Text style={styles.brandDot}>.</Text></Text><Text style={styles.greeting}>Your money, in one view</Text></View></View><Pressable onPress={() => { setProfile({ name: user?.name || '', password: '' }); setProfileModal(true); }} onLongPress={() => setShowApiLog(v => !v)} style={styles.avatar}><Text style={styles.avatarText}>{(displayName[0] || 'Q').toUpperCase()}</Text></Pressable></View>
    <ScrollView contentContainerStyle={styles.pageContent} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} tintColor={C.green} />}>
      {page === 'home' && (() => {
        const nw = dashboard?.totals?.net_worth || 0;
        const assets = dashboard?.totals?.assets || 0;
        const liabs = dashboard?.totals?.liabilities || 0;
        const inc = dashboard?.monthly?.income || 0;
        const exp = dashboard?.monthly?.expenses || 0;
        const surplus = dashboard?.monthly?.surplus || 0;
        const score = dashboard?.health?.score ?? 0;
        const scoreLabel = dashboard?.health?.label || 'Building';
        const breakdown = dashboard?.asset_breakdown || [];
        const oneYr = dashboard?.projections?.one_year?.net_worth || 0;
        const fiveYr = dashboard?.projections?.five_year?.net_worth || 0;
        const oneYrGrowth = nw > 0 ? ((oneYr - nw) / nw * 100).toFixed(1) : null;
        const fiveYrGrowth = nw > 0 ? ((fiveYr - nw) / nw * 100).toFixed(1) : null;
        const sparkW = SW - 36 - 44;
        return <>
          {/* ── HERO CARD ── */}
          <View style={styles.heroCard}>
            <View style={styles.heroCardTop}>
              <View>
                <Text style={styles.heroGreeting}>Good day, {user?.name?.split(' ')[0] || 'there'} 👋</Text>
                <Text style={styles.heroEyebrow}>NET WORTH</Text>
                <Text style={styles.heroAmount}>{money(nw)}</Text>
                <Text style={styles.heroDate}>as of {dashboard?.as_of || '—'}</Text>
              </View>
              <View style={styles.heroRight}>
                <HealthArc score={score} size={88} />
                <Text style={styles.heroHealthScore}>{score}</Text>
                <Text style={styles.heroHealthLabel}>{scoreLabel}</Text>
              </View>
            </View>
            {/* sparkline */}
            {history.length > 1 && <View style={{ marginTop: 16 }}>
              <Sparkline data={history} width={sparkW} height={52} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                <Text style={styles.sparkLabel}>{history[0]?.date}</Text>
                <Text style={styles.sparkLabel}>{history[history.length - 1]?.date}</Text>
              </View>
            </View>}
            {/* assets vs liabilities strip */}
            <View style={styles.heroStrip}>
              <View style={styles.heroStripItem}>
                <Text style={styles.heroStripLabel}>ASSETS</Text>
                <Text style={styles.heroStripValue}>{money(assets, true)}</Text>
              </View>
              <View style={styles.heroStripDivider} />
              <View style={styles.heroStripItem}>
                <Text style={styles.heroStripLabel}>LIABILITIES</Text>
                <Text style={[styles.heroStripValue, { color: '#F4A89A' }]}>{money(liabs, true)}</Text>
              </View>
              <View style={styles.heroStripDivider} />
              <View style={styles.heroStripItem}>
                <Text style={styles.heroStripLabel}>SURPLUS/MO</Text>
                <Text style={[styles.heroStripValue, { color: surplus >= 0 ? C.lime : '#F4A89A' }]}>{money(surplus, true)}</Text>
              </View>
            </View>
          </View>

          {/* ── QUICK STATS ROW ── */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 18 }} contentContainerStyle={{ gap: 10, paddingHorizontal: 2 }}>
            {[{ label: 'Monthly Income', value: money(inc, true), color: C.green, bg: C.mint },
              { label: 'Monthly Expenses', value: money(exp, true), color: C.red, bg: C.redBg },
              { label: 'EMI / month', value: money(dashboard?.monthly?.emi || 0, true), color: C.blue, bg: '#EAF0F5' },
              { label: 'Savings rate', value: inc > 0 ? `${Math.round(Math.max(0, surplus) / inc * 100)}%` : '—', color: '#9B6B9E', bg: '#F3EEF7' },
            ].map(s => <View key={s.label} style={[styles.quickStat, { backgroundColor: s.bg }]}>
              <Text style={[styles.quickStatValue, { color: s.color }]}>{s.value}</Text>
              <Text style={styles.quickStatLabel}>{s.label}</Text>
            </View>)}
          </ScrollView>

          {/* ── CASH FLOW VISUAL ── */}
          <SectionTitle title="Cash flow" action="Details" onAction={() => setPage('cashflow')} />
          <Card>
            <View style={styles.splitRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cfLabel}>Income</Text>
                <Text style={styles.cfIncome}>{money(inc, true)}</Text>
              </View>
              <View style={styles.cfArrow}><Text style={{ color: surplus >= 0 ? C.green : C.red, fontSize: 22 }}>{surplus >= 0 ? '↗' : '↘'}</Text></View>
              <View style={{ flex: 1, alignItems: 'flex-end' }}>
                <Text style={styles.cfLabel}>Expenses</Text>
                <Text style={styles.cfExpense}>{money(exp, true)}</Text>
              </View>
            </View>
            <View style={{ marginTop: 14 }}>
              <CashFlowBar income={inc} expenses={exp} />
            </View>
            <View style={[styles.cfSurplusRow, { borderTopColor: C.border }]}>
              <Text style={styles.muted}>Monthly surplus after EMIs</Text>
              <Text style={[styles.cfSurplusAmt, { color: surplus >= 0 ? C.green : C.red }]}>{money(surplus, true)}</Text>
            </View>
          </Card>

          {/* ── ASSET ALLOCATION DONUT ── */}
          <SectionTitle title="Where your money is" action="Manage" onAction={() => setPage('records')} />
          <Card>
            {breakdown.length ? <View style={styles.donutRow}>
              <DonutChart data={breakdown} size={130} />
              <View style={styles.donutLegend}>
                {breakdown.slice(0, 5).map((item, i) => {
                  const COLORS = [C.green, C.blue, C.gold, '#9B6B9E', '#E07B54'];
                  const pct = assets > 0 ? Math.round(item.value / assets * 100) : 0;
                  return <View key={item.category} style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: COLORS[i % 5] }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.legendName} numberOfLines={1}>{labelize(item.category)}</Text>
                      <Text style={styles.legendPct}>{pct}% · {money(item.value, true)}</Text>
                    </View>
                  </View>;
                })}
              </View>
            </View> : <Empty title="Start with one asset" body="Add cash, an FD, investments or property to see your allocation." />}
          </Card>

          {/* ── PROJECTIONS ── */}
          <SectionTitle title="Your outlook" action="Explore" onAction={() => setPage('plan')} />
          <View style={styles.projRow}>
            <View style={styles.projCard}>
              <Text style={styles.projCardEyebrow}>1 YEAR · PROJECTED</Text>
              <Text style={styles.projCardDate}>{projDate(dashboard?.as_of, 1)}</Text>
              <Text style={styles.projCardAmount}>{money(oneYr, true)}</Text>
              {oneYrGrowth && <View style={[styles.projBadge, { backgroundColor: Number(oneYrGrowth) >= 0 ? '#E6F4EC' : C.redBg }]}>
                <Text style={[styles.projBadgeText, { color: Number(oneYrGrowth) >= 0 ? C.green : C.red }]}>{Number(oneYrGrowth) >= 0 ? '+' : ''}{oneYrGrowth}%</Text>
              </View>}
            </View>
            <View style={[styles.projCard, { backgroundColor: C.deep }]}>
              <Text style={[styles.projCardEyebrow, { color: '#AFC7B8' }]}>5 YEARS · PROJECTED</Text>
              <Text style={[styles.projCardDate, { color: '#7BA898' }]}>{projDate(dashboard?.as_of, 5)}</Text>
              <Text style={[styles.projCardAmount, { color: '#FFF' }]}>{money(fiveYr, true)}</Text>
              {fiveYrGrowth && <View style={[styles.projBadge, { backgroundColor: '#285440' }]}>
                <Text style={[styles.projBadgeText, { color: C.lime }]}>{Number(fiveYrGrowth) >= 0 ? '+' : ''}{fiveYrGrowth}%</Text>
              </View>}
            </View>
          </View>
          <Text style={styles.disclaimer}>Model-based estimates, not guaranteed returns.</Text>

          {/* ── HEALTH DETAIL CARD ── */}
          <SectionTitle title="Financial health" action="View insights" onAction={() => setPage('plan')} />
          <Card>
            <View style={styles.healthDetailRow}>
              <View style={styles.healthDetailLeft}>
                <Text style={styles.healthBigScore}>{score}<Text style={styles.healthBigOf}>/100</Text></Text>
                <Text style={styles.healthBigLabel}>{scoreLabel}</Text>
              </View>
              <View style={styles.healthMetrics}>
                {[{ label: 'Savings rate', value: `${dashboard?.health?.metrics?.savings_rate_pct ?? 0}%` },
                  { label: 'Debt-to-income', value: `${dashboard?.health?.metrics?.debt_to_income_pct ?? 0}%` },
                  { label: 'Emergency fund', value: `${dashboard?.health?.metrics?.emergency_fund_months ?? 0} mo` },
                ].map(m => <View key={m.label} style={styles.healthMetricItem}>
                  <Text style={styles.healthMetricValue}>{m.value}</Text>
                  <Text style={styles.healthMetricLabel}>{m.label}</Text>
                </View>)}
              </View>
            </View>
            {/* health sub-bars */}
            {[{ label: 'Savings rate', pct: Math.min(100, (dashboard?.health?.metrics?.savings_rate_pct ?? 0) * 2), color: C.green, pts: Math.round(Math.min(25, Math.max(0, dashboard?.health?.metrics?.savings_rate_pct ?? 0) * 0.5)), max: 25 },
              { label: 'Low debt ratio', pct: Math.max(0, 100 - (dashboard?.health?.metrics?.debt_to_income_pct ?? 0) * 2), color: C.blue, pts: Math.round(Math.max(0, 25 - Math.min(25, (dashboard?.health?.metrics?.debt_to_income_pct ?? 0) * 0.6))), max: 25 },
              { label: 'Emergency fund', pct: Math.min(100, (dashboard?.health?.metrics?.emergency_fund_months ?? 0) / 6 * 100), color: C.gold, pts: Math.round(Math.min(20, (dashboard?.health?.metrics?.emergency_fund_months ?? 0) * 5)), max: 20 },
              { label: 'Asset diversity', pct: Math.min(100, (dashboard?.asset_breakdown?.length ?? 0) / 3 * 100), color: '#9B6B9E', pts: Math.min(15, (dashboard?.asset_breakdown?.length ?? 0) * 5), max: 15 },
              { label: 'Monthly surplus', pct: (dashboard?.health?.metrics?.monthly_surplus ?? 0) > 0 ? 100 : 47, color: '#E07B54', pts: (dashboard?.health?.metrics?.monthly_surplus ?? 0) > 0 ? 15 : 7, max: 15 },
            ].map(b => <View key={b.label} style={{ marginTop: 10 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={styles.healthBarLabel}>{b.label}</Text>
                <Text style={styles.healthBarLabel}>{b.pts}/{b.max} pts</Text>
              </View>
              <View style={styles.barBg}><View style={[styles.barFill, { width: `${Math.max(2, b.pct)}%`, backgroundColor: b.color }]} /></View>
            </View>)}
            <Pressable onPress={() => setHealthInfoVisible(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 14 }}>
              <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: C.mint, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: C.green, fontSize: 10, fontWeight: '800' }}>i</Text></View>
              <Text style={{ color: C.green, fontSize: 11, fontWeight: '600' }}>How is this score calculated?</Text>
            </Pressable>
          </Card>
        </>;
      })()}
      {page === 'records' && <>
        <PageHeading title="Your records" subtitle="Add the numbers you want to keep in view." />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>{['asset', 'liability'].map(k => <Pill key={k} title={labelize(k)} active={recordsTab === k} onPress={() => setRecordsTab(k)} />)}</ScrollView>
        <Button title={`＋  Add ${recordsTab === 'asset' ? 'asset' : 'liability'}`} onPress={() => openForm(recordsTab)} style={{ marginTop: 14, marginBottom: 8 }} />
        {shownEntries.length ? shownEntries.map(item => <RecordRow key={item.id} item={item} onDelete={() => deleteEntry(item.id)} onEdit={() => openEdit(item)} />) : <Card><Empty title={`No ${recordsTab === 'asset' ? 'assets' : 'liabilities'} yet`} body="Your records stay private to your Qlots account. Add one when you are ready." /></Card>}
        <Text style={styles.disclaimer}>Values are entered by you; Qlots does not connect to banks or brokers in this MVP.</Text>
      </>}
      {page === 'cashflow' && <>
        <PageHeading title="Cash flow" subtitle="Track recurring income and expenses." />
        <Card><View style={styles.splitRow}><Metric label="Income / month" value={money(dashboard?.monthly?.income)} positive /><Metric label="Expenses / month" value={money(dashboard?.monthly?.expenses)} /><Metric label="Loan EMI / month" value={money(dashboard?.monthly?.emi)} /></View><View style={styles.flowBalance}><Text style={styles.muted}>Monthly surplus after EMIs</Text><Text style={[styles.flowBalanceAmount, { color: (dashboard?.monthly?.surplus || 0) >= 0 ? C.green : C.red }]}>{money(dashboard?.monthly?.surplus)}</Text></View></Card>
        <View style={styles.pillRow}>{['income', 'expense'].map(k => <Pill key={k} title={labelize(k)} active={flowTab === k} onPress={() => setFlowTab(k)} />)}</View>
        <Button title={`＋  Add ${flowTab}`} onPress={() => openForm(flowTab)} style={{ marginBottom: 12 }} />
        {shownEntries.length ? shownEntries.map(item => <RecordRow key={item.id} item={item} onDelete={() => deleteEntry(item.id)} onEdit={() => openEdit(item)} />) : <Card><Empty title={`No ${flowTab} records`} body="Add a monthly or other recurring amount to make cash-flow insights more useful." /></Card>}
      </>}
      {page === 'history' && <>
        <PageHeading title="Net worth history" subtitle="Daily snapshots since you started tracking." />
        {history.length > 1 ? history.map((s, i) => {
          const prev = history[i - 1];
          const delta = prev ? s.net_worth - prev.net_worth : 0;
          return <Card key={s.date} style={styles.historyRow}>
            <View><Text style={styles.historyDate}>{s.date}</Text></View>
            <View style={styles.historyRight}>
              <Text style={styles.historyAmount}>{money(s.net_worth, true)}</Text>
              {i > 0 && <Text style={[styles.historyDelta, { color: delta >= 0 ? C.green : C.red }]}>{delta >= 0 ? '+' : ''}{money(delta, true)}</Text>}
            </View>
          </Card>;
        }) : <Card><Empty title="Not enough data yet" body="Come back tomorrow — a new snapshot is saved each day you open the app." /></Card>}
      </>}
      {page === 'plan' && <>
        <PageHeading title="Plan & insights" subtitle="See how your assumptions shape the long view." />
        <Card><Text style={styles.cardHeading}>Projection assumptions</Text><Text style={styles.muted}>Adjust values and compare modeled scenarios.</Text>
          <Field label="Salary growth · % / year" value={assumptions.salary_growth} onChangeText={v => setAssumptions({ ...assumptions, salary_growth: v })} keyboardType="decimal-pad" />
          <Field label="Equity return · % / year" value={assumptions.equity_return} onChangeText={v => setAssumptions({ ...assumptions, equity_return: v })} keyboardType="decimal-pad" />
          <Field label="Property growth · % / year" value={assumptions.property_growth} onChangeText={v => setAssumptions({ ...assumptions, property_growth: v })} keyboardType="decimal-pad" />
          <Field label="Inflation · % / year" value={assumptions.inflation} onChangeText={v => setAssumptions({ ...assumptions, inflation: v })} keyboardType="decimal-pad" />
          <Field label="Monthly investment · ₹" value={assumptions.monthly_investment} onChangeText={v => setAssumptions({ ...assumptions, monthly_investment: v })} keyboardType="decimal-pad" />
          <Button title={busy ? 'Updating…' : 'Recalculate projection'} onPress={saveAssumptions} disabled={busy} style={{ marginTop: 4 }} />
        </Card>
        <SectionTitle title="Compare scenarios" />
        <View style={styles.pillRow}>{['conservative', 'base', 'optimistic'].map(s => <Pill key={s} title={labelize(s)} active={scenario === s} onPress={() => runScenario(s)} />)}</View>
        {(forecast?.projections || [dashboard?.projections?.one_year, dashboard?.projections?.five_year].filter(Boolean)).map((p, i) => <Card key={`${p.year}-${i}`} style={styles.forecastRow}><View><Text style={styles.projectionLabel}>{p.year === 1 ? '1 YEAR' : p.year === 5 ? '5 YEARS' : `${p.year} YEARS`} · {projDate(dashboard?.as_of, p.year)}</Text><Text style={styles.muted}>Assets {money(p.assets, true)} · Debt {money(p.liabilities, true)}</Text></View><Text style={styles.forecastAmount}>{money(p.net_worth, true)}</Text></Card>)}
        <Text style={styles.disclaimer}>These are model-based projections. Returns and future net worth are not guaranteed.</Text>
        <SectionTitle title="Financial helper" />
        <Card><Text style={styles.cardHeading}>Ask about your entered numbers</Text><Text style={styles.muted}>Answers use the finance calculations in this app; this MVP does not send data to an AI provider.</Text><TextInput value={question} onChangeText={setQuestion} placeholder="e.g. What is my current net worth?" placeholderTextColor="#98A39C" multiline style={[styles.input, styles.questionInput]} /><Button title={busy ? 'Working…' : 'Ask Qlots'} onPress={askHelper} disabled={busy} />{answer ? <View style={styles.answerBox}><Text style={styles.answerText}>{answer}</Text></View> : null}</Card>
        <Button title="Generate financial PDF report" secondary onPress={makeReport} disabled={busy} style={{ marginTop: 16 }} />
        <Text style={styles.disclaimer}>Report is for informational and planning purposes only.</Text>
      </>}
      <View style={{ height: 22 }} />
    </ScrollView>
    <View style={styles.tabbar}>{[['home', 'Overview', '◈'], ['records', 'Wealth', '▤'], ['cashflow', 'Cash flow', '↗'], ['history', 'History', '◷'], ['plan', 'Plan', '◎']].map(([key, label, glyph]) => <Pressable key={key} onPress={() => setPage(key)} style={styles.tabItem}><Text style={[styles.tabIcon, page === key && styles.tabIconActive]}>{glyph}</Text><Text style={[styles.tabLabel, page === key && styles.tabLabelActive]}>{label}</Text></Pressable>)}</View>
    <EntryModal visible={modal} onClose={() => setModal(false)} kind={formKind} form={form} setForm={setForm} onSave={saveEntry} busy={busy} isEdit={!!editEntry} />
    <ProfileModal visible={profileModal} onClose={() => setProfileModal(false)} profile={profile} setProfile={setProfile} onSave={saveProfile} onDeleteAccount={() => setDeleteConfirmVisible(true)} onSignOut={signOut} busy={busy} user={user} />
    <Modal visible={deleteConfirmVisible} transparent animationType="fade" onRequestClose={() => setDeleteConfirmVisible(false)}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 }} onPress={() => setDeleteConfirmVisible(false)}>
        <Pressable style={{ backgroundColor: C.card, borderRadius: 20, padding: 24 }} onPress={() => {}}>
          <Text style={{ color: C.ink, fontWeight: '800', fontSize: 18, marginBottom: 10 }}>Delete account?</Text>
          <Text style={{ color: C.muted, fontSize: 14, lineHeight: 21, marginBottom: 24 }}>This will permanently delete your account and all your financial data. This cannot be undone.</Text>
          <Pressable onPress={doDeleteAccount} style={{ backgroundColor: C.red, borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 10 }}>
            <Text style={{ color: '#FFF', fontWeight: '700', fontSize: 14 }}>Yes, delete everything</Text>
          </Pressable>
          <Pressable onPress={() => setDeleteConfirmVisible(false)} style={{ backgroundColor: C.mint, borderRadius: 12, padding: 14, alignItems: 'center' }}>
            <Text style={{ color: C.green, fontWeight: '700', fontSize: 14 }}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
    <Modal visible={healthInfoVisible} transparent animationType="fade" onRequestClose={() => setHealthInfoVisible(false)}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 }} onPress={() => setHealthInfoVisible(false)}>
        <Pressable style={{ backgroundColor: C.card, borderRadius: 20, padding: 22 }} onPress={() => {}}>
          <Text style={{ color: C.ink, fontWeight: '800', fontSize: 17, marginBottom: 4 }}>Health Score Breakdown</Text>
          <Text style={{ color: C.muted, fontSize: 12, marginBottom: 16 }}>Score = sum of 5 components (max 100)</Text>
          {[{ label: 'Savings rate', max: 25, how: 'Surplus ÷ Income × 100. Each 2% savings = 1 pt, up to 25.' },
            { label: 'Low debt ratio', max: 25, how: 'EMI ÷ Income × 100. 0% debt = 25 pts. Each 1.67% DTI loses 1 pt.' },
            { label: 'Emergency fund', max: 20, how: 'Liquid cash ÷ Monthly expenses. Each month of cover = 5 pts, up to 6 months.' },
            { label: 'Asset diversity', max: 15, how: 'Number of different asset categories. 3+ types = 15 pts.' },
            { label: 'Monthly surplus', max: 15, how: 'Positive surplus = 15 pts. Zero surplus = 7 pts. Deficit = 0 pts.' },
          ].map(c => <View key={c.label} style={{ marginBottom: 14 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: C.ink, fontWeight: '700', fontSize: 13 }}>{c.label}</Text>
              <Text style={{ color: C.green, fontWeight: '700', fontSize: 13 }}>max {c.max} pts</Text>
            </View>
            <Text style={{ color: C.muted, fontSize: 11, marginTop: 3, lineHeight: 16 }}>{c.how}</Text>
          </View>)}
          <Text style={{ color: C.muted, fontSize: 10, marginTop: 4 }}>This is an educational indicator based on your entered data — not professional financial advice.</Text>
        </Pressable>
      </Pressable>
    </Modal>
    <Modal visible={showApiLog} animationType="slide" onRequestClose={() => setShowApiLog(false)}>
      <View style={{ flex: 1, backgroundColor: '#0D1F17', paddingTop: (StatusBar.currentHeight || 24) + 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderColor: '#1A3D2E' }}>
          <Text style={{ color: '#C8E8A9', fontWeight: '800', fontSize: 16 }}>API Log</Text>
          <Pressable onPress={() => setShowApiLog(false)} style={{ padding: 8 }}><Text style={{ color: '#7ECBA1', fontSize: 22 }}>×</Text></Pressable>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, gap: 6 }}>
          {apiLogs.length === 0 && <Text style={{ color: '#5A7A6A', textAlign: 'center', marginTop: 40 }}>No requests yet</Text>}
          {apiLogs.map((log, i) => (
            <View key={i} style={{ backgroundColor: '#1A3D2E', borderRadius: 8, padding: 10 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: log.status >= 400 || log.status === 'ERR' ? '#F4A89A' : '#C8E8A9', fontWeight: '700', fontSize: 11 }}>{log.method} {log.path}</Text>
                <Text style={{ color: log.status >= 400 || log.status === 'ERR' ? '#F4A89A' : '#7ECBA1', fontSize: 11 }}>{log.status} · {log.ms}ms</Text>
              </View>
              <Text style={{ color: '#5A7A6A', fontSize: 10, marginTop: 2 }}>{log.time}</Text>
              {log.error ? <Text style={{ color: '#F4A89A', fontSize: 10, marginTop: 3 }}>{log.error}</Text> : null}
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  </View>;
}


function ApiLogPanel({ onClose }) {
  const logs = useApiLogs();
  const [selected, setSelected] = useState(null);
  if (!NETWORK_LOG_ENABLED) return (
    <View style={{ flex: 1, backgroundColor: '#0D1F17', paddingTop: (StatusBar.currentHeight || 24) + 8, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#5A7A6A', textAlign: 'center', paddingHorizontal: 32, lineHeight: 22 }}>Network logging is disabled.{'\n\n'}Set EXPO_PUBLIC_NETWORK_LOG=true in .env and rebuild to enable.</Text>
      <Pressable onPress={onClose} style={{ marginTop: 24, backgroundColor: '#1A3D2E', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 }}><Text style={{ color: '#C8E8A9', fontWeight: '700' }}>Close</Text></Pressable>
    </View>
  );
  return (
    <View style={{ flex: 1, backgroundColor: '#0D1F17', paddingTop: (StatusBar.currentHeight || 24) + 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderColor: '#1A3D2E' }}>
        <Text style={{ color: '#C8E8A9', fontWeight: '800', fontSize: 16 }}>Network Log ({logs.length})</Text>
        <Pressable onPress={onClose} style={{ padding: 8 }}><Text style={{ color: '#7ECBA1', fontSize: 22 }}>×</Text></Pressable>
      </View>
      {selected ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14 }}>
          <Pressable onPress={() => setSelected(null)} style={{ marginBottom: 12 }}><Text style={{ color: '#7ECBA1', fontSize: 12 }}>← Back to list</Text></Pressable>
          <Text style={{ color: '#C8E8A9', fontWeight: '800', fontSize: 13 }}>{selected.method} {selected.path}</Text>
          <Text style={{ color: '#5A7A6A', fontSize: 11, marginTop: 2 }}>{selected.time} · {selected.status} · {selected.ms}ms</Text>
          {selected.error && <Text style={{ color: '#F4A89A', fontSize: 12, marginTop: 8, backgroundColor: '#2A1A1A', padding: 8, borderRadius: 6 }}>{selected.error}</Text>}
          {selected.reqBody && <>
            <Text style={{ color: '#7ECBA1', fontWeight: '700', fontSize: 11, marginTop: 14, marginBottom: 4 }}>REQUEST BODY</Text>
            <ScrollView horizontal><Text style={{ color: '#C8E8A9', fontSize: 10, fontFamily: 'monospace', backgroundColor: '#1A3D2E', padding: 8, borderRadius: 6 }}>{JSON.stringify(JSON.parse(selected.reqBody), null, 2)}</Text></ScrollView>
          </>}
          {selected.resBody && <>
            <Text style={{ color: '#7ECBA1', fontWeight: '700', fontSize: 11, marginTop: 14, marginBottom: 4 }}>RESPONSE BODY</Text>
            <ScrollView horizontal><Text style={{ color: '#C8E8A9', fontSize: 10, fontFamily: 'monospace', backgroundColor: '#1A3D2E', padding: 8, borderRadius: 6 }}>{(() => { try { return JSON.stringify(JSON.parse(selected.resBody), null, 2); } catch { return selected.resBody; } })()}</Text></ScrollView>
          </>}
        </ScrollView>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, gap: 6 }}>
          {logs.length === 0 && <Text style={{ color: '#5A7A6A', textAlign: 'center', marginTop: 40 }}>No requests yet</Text>}
          {logs.map((log, i) => (
            <Pressable key={i} onPress={() => setSelected(log)} style={{ backgroundColor: '#1A3D2E', borderRadius: 8, padding: 10 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: log.status >= 400 || log.status === 'ERR' ? '#F4A89A' : '#C8E8A9', fontWeight: '700', fontSize: 11, flex: 1 }} numberOfLines={1}>{log.method} {log.path}</Text>
                <Text style={{ color: log.status >= 400 || log.status === 'ERR' ? '#F4A89A' : '#7ECBA1', fontSize: 11 }}>{log.status} · {log.ms}ms</Text>
              </View>
              <Text style={{ color: '#5A7A6A', fontSize: 10, marginTop: 2 }}>{log.time}</Text>
              {log.error ? <Text style={{ color: '#F4A89A', fontSize: 10, marginTop: 3 }} numberOfLines={1}>{log.error}</Text> : null}
              {(log.reqBody || log.resBody) && <Text style={{ color: '#3A6A4A', fontSize: 9, marginTop: 2 }}>Tap to see request/response body</Text>}
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function AuthScreen({ auth, setAuth, mode, setMode, onSubmit, busy, toast }) {
  return (
    <KeyboardAvoidingView style={styles.authRoot} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Toast toast={toast} />
      <ScrollView contentContainerStyle={styles.authScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.authMark}><QlotsLogo size={72} /></View>
        <Text style={styles.brandAuth}>Qlots<Text style={styles.brandDot}>.</Text></Text>
        <Text style={styles.authTitle}>Your financial picture, together.</Text>
        <Text style={styles.authSub}>Track what you own, what you owe, and how your plans could grow.</Text>
        <Card style={styles.authCard}>
          {mode === 'register' ? <Field label="Your name" value={auth.name} onChangeText={v => setAuth({ ...auth, name: v })} /> : null}
          <Field label="Email address" value={auth.email} onChangeText={v => setAuth({ ...auth, email: v })} keyboardType="email-address" />
          <Field label="Password" value={auth.password} onChangeText={v => setAuth({ ...auth, password: v })} secureTextEntry hint={mode === 'register' ? 'Use at least 10 characters.' : null} />
          <Button title={busy ? 'Please wait…' : mode === 'register' ? 'Create my account' : 'Sign in'} onPress={onSubmit} disabled={busy} style={{ marginTop: 8 }} />
          <Pressable onPress={() => setMode(mode === 'login' ? 'register' : 'login')} style={styles.authToggle}>
            <Text style={styles.authToggleText}>{mode === 'login' ? 'New to Qlots? Create an account' : 'Already have an account? Sign in'}</Text>
          </Pressable>
        </Card>
        <Text style={styles.authFoot}>Your financial information is sensitive. Use a unique password. Qlots is a planning tool, not financial advice.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
function PageHeading({ title, subtitle }) { return <View style={styles.pageHeading}><Text style={styles.pageTitle}>{title}</Text><Text style={styles.pageSubtitle}>{subtitle}</Text></View>; }
function Metric({ label, value, positive }) { return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={[styles.metricValue, positive === false && { color: C.ink }]} numberOfLines={1}>{value}</Text></View>; }
function Allocation({ item, total }) { const pct = total > 0 ? Math.max(0, item.value / total) : 0; return <View style={styles.allocation}><View style={styles.allocationHead}><Text style={styles.allocationName}>{labelize(item.category)}</Text><Text style={styles.allocationValue}>{money(item.value, true)}</Text></View><View style={styles.barBg}><View style={[styles.barFill, { width: `${Math.max(3, pct * 100)}%` }]} /></View></View>; }
function RecordRow({ item, onDelete, onEdit }) { return <Card style={styles.recordCard}><View style={styles.recordIcon}><Text style={styles.recordGlyph}>{item.kind === 'liability' ? '−' : item.kind === 'expense' ? '↘' : item.kind === 'income' ? '↗' : '＋'}</Text></View><View style={styles.recordInfo}><Text style={styles.recordName}>{item.name}</Text><Text style={styles.muted}>{labelize(item.category)}{item.institution ? ` · ${item.institution}` : ''}</Text>{item.kind === 'asset' && item.category === 'fixed_deposit' ? <Text style={styles.hint}>Principal {money(item.principal)} · {item.annual_rate}% p.a.</Text> : item.kind === 'liability' && item.emi ? <Text style={styles.hint}>EMI {money(item.emi)}/month · {item.annual_rate}% p.a.</Text> : ['income', 'expense'].includes(item.kind) ? <Text style={styles.hint}>{labelize(item.frequency)}</Text> : null}</View><View style={styles.recordRight}><Text style={[styles.recordAmount, item.kind === 'liability' && { color: C.red }]}>{money(item.amount, true)}</Text><View style={{ flexDirection: 'row', gap: 10 }}><Pressable onPress={onEdit}><Text style={styles.editLink}>Edit</Text></Pressable><Pressable onPress={onDelete}><Text style={styles.deleteLink}>Remove</Text></Pressable></View></View></Card>; }

function DateField({ label, value, onChange, optional = false }) {
  const [show, setShow] = useState(false);
  const dateObj = value ? new Date(value) : new Date();
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable onPress={() => setShow(true)} style={[styles.input, styles.dateInput]}>
        <Text style={{ color: value ? C.ink : '#98A39C', fontSize: 14 }}>{value || (optional ? 'Not set' : 'Tap to select')}</Text>
        <Text style={{ color: C.muted, fontSize: 16 }}>📅</Text>
      </Pressable>
      {show && (
        <DateTimePicker
          value={dateObj}
          mode="date"
          display="default"
          onChange={(_, selected) => {
            setShow(false);
            if (selected) onChange(selected.toISOString().split('T')[0]);
          }}
        />
      )}
    </View>
  );
}

function EntryModal({ visible, onClose, kind, form, setForm, onSave, busy, isEdit }) {
  const categories = CATEGORIES[kind] || CATEGORIES.asset;
  const isFD = kind === 'asset' && form.category === 'fixed_deposit';
  const isRD = kind === 'asset' && form.category === 'recurring_deposit';
  const isLoan = kind === 'liability';
  const set = (key, value) => setForm({ ...form, [key]: value });
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.modalHeader}>
          <View>
            <Text style={styles.modalEyebrow}>{isEdit ? 'EDIT' : 'NEW'} {kind.toUpperCase()}</Text>
            <Text style={styles.modalTitle}>{isEdit ? 'Update record' : 'Add to your picture'}</Text>
          </View>
          <Pressable onPress={onClose} style={styles.closeButton}><Text style={styles.closeText}>×</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.fieldLabel}>Category</Text>
          <View style={styles.categoryGrid}>{categories.map(c => <Pill key={c} title={labelize(c)} active={form.category === c} onPress={() => set('category', c)} />)}</View>
          <Field label="Name" value={form.name} onChangeText={v => set('name', v)} placeholder={kind === 'asset' ? 'e.g. Main savings' : kind === 'liability' ? 'e.g. Home loan' : 'e.g. Salary'} />
          <Field label={kind === 'liability' ? 'Outstanding balance · ₹' : kind === 'income' || kind === 'expense' ? 'Amount per period · ₹' : 'Current value · ₹'} value={form.amount} onChangeText={v => set('amount', v)} keyboardType="decimal-pad" />
          {(isFD || isRD || isLoan) ? <Field label={isFD || isRD ? 'Original principal / instalment · ₹' : 'Annual interest rate · %'} value={isFD || isRD ? form.principal : form.annual_rate} onChangeText={v => set(isFD || isRD ? 'principal' : 'annual_rate', v)} keyboardType="decimal-pad" /> : null}
          {(isFD || isRD || isLoan) ? <Field label={isFD || isRD ? 'Annual interest rate · %' : 'Monthly EMI · ₹'} value={isFD || isRD ? form.annual_rate : form.emi} onChangeText={v => set(isFD || isRD ? 'annual_rate' : 'emi', v)} keyboardType="decimal-pad" /> : null}
          {isLoan ? <Field label="Loan tenure · months (optional)" value={form.tenure_months} onChangeText={v => set('tenure_months', v)} keyboardType="number-pad" hint="Used to calculate when the loan ends in projections." /> : null}
          {(isFD || isRD) ? <>
            <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Compounding frequency</Text>
            <View style={styles.categoryGrid}>{['monthly', 'quarterly', 'half_yearly', 'yearly'].map(f => <Pill key={f} title={labelize(f)} active={form.frequency === f} onPress={() => set('frequency', f)} />)}</View>
            <DateField label="Start date" value={form.start_date} onChange={v => set('start_date', v)} />
            <DateField label="Maturity date (optional)" value={form.maturity_date} onChange={v => set('maturity_date', v)} optional />
            <Text style={styles.hint}>Estimated compounding uses the selected frequency; bank-specific payout rules and tax may differ.</Text>
          </> : null}
          {kind === 'asset' && !isFD && !isRD ? <Field label="Expected annual return · % (optional)" value={form.annual_rate} onChangeText={v => set('annual_rate', v)} keyboardType="decimal-pad" /> : null}
          {kind === 'asset' ? <Field label="Custom growth rate · % (overrides return, optional)" value={form.growth_rate} onChangeText={v => set('growth_rate', v)} keyboardType="decimal-pad" hint="If set, projections use this rate instead of the global equity return." /> : null}
          {['income', 'expense'].includes(kind) ? <>
            <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Amount frequency</Text>
            <View style={styles.categoryGrid}>{['monthly', 'weekly', 'yearly'].map(f => <Pill key={f} title={labelize(f)} active={form.frequency === f} onPress={() => set('frequency', f)} />)}</View>
          </> : null}
          <Field label="Institution or provider · optional" value={form.institution} onChangeText={v => set('institution', v)} />
          <Field label="Notes · optional" value={form.notes} onChangeText={v => set('notes', v)} placeholder="Any extra details…" hint="Stored locally, not shared." />
          <Button title={busy ? 'Saving…' : isEdit ? 'Update record' : 'Save record'} onPress={onSave} disabled={busy} style={{ marginTop: 16 }} />
          <Text style={styles.modalFoot}>Only enter details you want to track. Do not enter PINs, passwords, card numbers or account access credentials.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ProfileModal({ visible, onClose, profile, setProfile, onSave, onDeleteAccount, onSignOut, busy, user }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.modalHeader}>
          <View><Text style={styles.modalEyebrow}>ACCOUNT</Text><Text style={styles.modalTitle}>Your profile</Text></View>
          <Pressable onPress={onClose} style={styles.closeButton}><Text style={styles.closeText}>×</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.muted}>Signed in as {user?.email}</Text>
          <Field label="Display name" value={profile.name} onChangeText={v => setProfile({ ...profile, name: v })} />
          <Field label="New password (leave blank to keep current)" value={profile.password} onChangeText={v => setProfile({ ...profile, password: v })} secureTextEntry hint="Minimum 10 characters if changing." />
          <Button title={busy ? 'Saving…' : 'Save changes'} onPress={onSave} disabled={busy} style={{ marginTop: 16 }} />
          <Button title="Sign out" secondary onPress={onSignOut} style={{ marginTop: 10 }} />
          <Pressable onPress={onDeleteAccount} style={styles.deletAccountBtn}>
            <Text style={styles.deleteAccountText}>Delete account and all data…</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: C.canvas, paddingBottom: 0 }, loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.canvas, gap: 12 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, paddingTop: Platform.OS === 'android' ? 38 : 58, paddingBottom: 14, backgroundColor: C.canvas },
  brand: { fontSize: 28, fontWeight: '800', color: C.deep, letterSpacing: -1.5 }, brandAuth: { fontSize: 34, fontWeight: '800', color: C.deep, textAlign: 'center', letterSpacing: -1.5 }, brandDot: { color: C.green }, greeting: { fontSize: 12, color: C.muted, marginTop: 1 }, avatar: { height: 40, width: 40, borderRadius: 15, backgroundColor: C.mint, justifyContent: 'center', alignItems: 'center' }, avatarText: { color: C.green, fontWeight: '800', fontSize: 17 },
  pageContent: { paddingHorizontal: 18, paddingBottom: 20 }, hero: { backgroundColor: C.deep, borderRadius: 25, padding: 22, marginTop: 5, marginBottom: 24 }, heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, eyebrowLight: { color: '#C1D8CE', fontSize: 10, letterSpacing: 1.4, fontWeight: '700' }, healthBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#285440', borderRadius: 16, paddingVertical: 7, paddingHorizontal: 10, gap: 6 }, healthDot: { height: 6, width: 6, borderRadius: 3, backgroundColor: C.lime }, healthBadgeText: { color: '#EAF5EF', fontSize: 11, fontWeight: '600' }, heroAmount: { color: '#FFF', fontSize: 35, fontWeight: '750', letterSpacing: -1.5, marginTop: 17 }, heroSub: { color: '#BDCEC5', fontSize: 12, marginTop: 5 }, heroDivider: { height: 1, backgroundColor: '#416250', marginVertical: 20 }, heroTotals: { flexDirection: 'row', alignItems: 'center', gap: 22 }, heroSmallLabel: { fontSize: 9, color: '#AFC7B8', letterSpacing: 1.1, fontWeight: '700' }, heroSmallAmount: { color: '#FFF', fontSize: 16, fontWeight: '700', marginTop: 5 }, heroVertical: { width: 1, height: 34, backgroundColor: '#416250' },
  // ── NEW HOME STYLES ──
  heroCard: { backgroundColor: C.deep, borderRadius: 28, padding: 22, marginTop: 4, marginBottom: 20 },
  heroCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  heroGreeting: { color: '#AFC7B8', fontSize: 13, fontWeight: '500', marginBottom: 6 },
  heroEyebrow: { color: '#7BA898', fontSize: 9, letterSpacing: 1.6, fontWeight: '700' },
  heroAmount: { color: '#FFF', fontSize: 34, fontWeight: '800', letterSpacing: -1.5, marginTop: 4 },
  heroDate: { color: '#7BA898', fontSize: 11, marginTop: 3 },
  heroRight: { alignItems: 'center', marginTop: -4 },
  heroHealthScore: { color: '#FFF', fontSize: 20, fontWeight: '800', marginTop: -18, textAlign: 'center' },
  heroHealthLabel: { color: C.lime, fontSize: 10, fontWeight: '700', textAlign: 'center', marginTop: 1 },
  sparkLabel: { color: '#5A7A6A', fontSize: 9 },
  heroStrip: { flexDirection: 'row', marginTop: 18, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#2A4A3A' },
  heroStripItem: { flex: 1, alignItems: 'center' },
  heroStripDivider: { width: 1, backgroundColor: '#2A4A3A' },
  heroStripLabel: { color: '#7BA898', fontSize: 8, letterSpacing: 1.1, fontWeight: '700' },
  heroStripValue: { color: '#FFF', fontSize: 14, fontWeight: '800', marginTop: 4 },
  // quick stats
  quickStat: { borderRadius: 16, paddingVertical: 12, paddingHorizontal: 16, minWidth: 110 },
  quickStatValue: { fontSize: 17, fontWeight: '800' },
  quickStatLabel: { fontSize: 10, color: C.muted, marginTop: 3 },
  // cash flow
  cfLabel: { color: C.muted, fontSize: 10, fontWeight: '600' },
  cfIncome: { color: C.green, fontSize: 18, fontWeight: '800', marginTop: 3 },
  cfExpense: { color: C.red, fontSize: 18, fontWeight: '800', marginTop: 3 },
  cfArrow: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  cfSurplusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, paddingTop: 12, borderTopWidth: 1 },
  cfSurplusAmt: { fontSize: 17, fontWeight: '800' },
  // donut
  donutRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  donutLegend: { flex: 1, gap: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  legendName: { color: C.ink, fontSize: 11, fontWeight: '600' },
  legendPct: { color: C.muted, fontSize: 10, marginTop: 1 },
  // projections
  projRow: { flexDirection: 'row', gap: 10, marginBottom: 6 },
  projCard: { flex: 1, backgroundColor: C.card, borderRadius: 20, padding: 16, borderWidth: 1, borderColor: C.border },
  projCardEyebrow: { color: C.muted, fontSize: 9, fontWeight: '700', letterSpacing: 0.8 },
  projCardDate: { color: C.green, fontSize: 12, fontWeight: '700', marginTop: 4 },
  projCardAmount: { color: C.ink, fontSize: 20, fontWeight: '800', marginTop: 6, letterSpacing: -0.5 },
  projBadge: { alignSelf: 'flex-start', borderRadius: 8, paddingVertical: 3, paddingHorizontal: 8, marginTop: 8 },
  projBadgeText: { fontSize: 11, fontWeight: '700' },
  // health detail
  healthDetailRow: { flexDirection: 'row', gap: 16, marginBottom: 4 },
  healthDetailLeft: { alignItems: 'center', justifyContent: 'center', width: 72 },
  healthBigScore: { color: C.green, fontSize: 32, fontWeight: '800' },
  healthBigOf: { color: C.muted, fontSize: 13, fontWeight: '400' },
  healthBigLabel: { color: C.ink, fontSize: 12, fontWeight: '700', marginTop: 2 },
  healthMetrics: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  healthMetricItem: { minWidth: 80 },
  healthMetricValue: { color: C.ink, fontSize: 15, fontWeight: '800' },
  healthMetricLabel: { color: C.muted, fontSize: 9, marginTop: 2 },
  healthBarLabel: { color: C.muted, fontSize: 10 },
  // ── END NEW HOME STYLES ──
  sectionTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 11, marginTop: 1 }, sectionTitle: { fontSize: 17, fontWeight: '700', color: C.ink, letterSpacing: -0.2 }, link: { color: C.green, fontSize: 12, fontWeight: '700' }, projectionRow: { flexDirection: 'row', gap: 10 }, projectionCard: { flex: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 17, padding: 14 }, projectionCardTint: { backgroundColor: '#EAF3EB' }, projectionLabel: { color: C.muted, fontSize: 9, fontWeight: '700', letterSpacing: 0.45 }, projectionValue: { color: C.ink, fontSize: 20, fontWeight: '800', marginTop: 8 }, disclaimer: { color: C.muted, fontSize: 10, lineHeight: 15, marginTop: 8, marginBottom: 19 }, card: { backgroundColor: C.card, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: C.border, marginBottom: 17 }, splitRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }, metric: { flex: 1 }, metricLabel: { color: C.muted, fontSize: 10, lineHeight: 14 }, metricValue: { color: C.green, fontWeight: '750', fontSize: 15, marginTop: 5 }, allocation: { marginBottom: 13 }, allocationHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 7 }, allocationName: { color: C.ink, fontSize: 12, fontWeight: '600' }, allocationValue: { color: C.ink, fontSize: 12, fontWeight: '700' }, barBg: { height: 6, borderRadius: 6, backgroundColor: '#EEF1ED', overflow: 'hidden' }, barFill: { height: 6, borderRadius: 6, backgroundColor: C.green }, healthCard: { flexDirection: 'row', alignItems: 'center', gap: 15 }, healthScoreWrap: { width: 60, height: 60, borderRadius: 20, backgroundColor: C.mint, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', paddingTop: 17 }, healthScore: { fontSize: 21, color: C.green, fontWeight: '800' }, healthScoreOf: { fontSize: 9, color: C.green }, healthTitle: { color: C.ink, fontWeight: '700', marginBottom: 4 }, muted: { color: C.muted, fontSize: 12, lineHeight: 17 },
  tabbar: { flexDirection: 'row', justifyContent: 'space-around', paddingTop: 10, paddingBottom: Platform.OS === 'android' ? 52 : 22, backgroundColor: C.card, borderTopWidth: 1, borderColor: C.border, elevation: 8 }, tabItem: { alignItems: 'center', minWidth: 65, gap: 2 }, tabIcon: { color: '#96A099', fontSize: 21, lineHeight: 24 }, tabIconActive: { color: C.green }, tabLabel: { color: C.muted, fontSize: 9, fontWeight: '500' }, tabLabelActive: { color: C.green, fontWeight: '800' },
  pageHeading: { marginTop: 8, marginBottom: 17 }, pageTitle: { color: C.ink, fontSize: 27, fontWeight: '800', letterSpacing: -0.8 }, pageSubtitle: { color: C.muted, fontSize: 13, marginTop: 4 }, pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }, pill: { paddingVertical: 9, paddingHorizontal: 13, borderRadius: 20, backgroundColor: '#EAEEE8', borderWidth: 1, borderColor: 'transparent' }, pillActive: { backgroundColor: C.deep, borderColor: C.deep }, pillText: { color: C.muted, fontSize: 11, fontWeight: '600' }, pillTextActive: { color: '#FFF' }, button: { minHeight: 48, backgroundColor: C.green, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 }, buttonSecondary: { backgroundColor: C.mint, borderWidth: 1, borderColor: '#CDE4D6' }, buttonSmall: { minHeight: 38 }, buttonText: { color: '#FFF', fontSize: 14, fontWeight: '750' }, buttonTextSecondary: { color: C.green }, buttonTextSmall: { fontSize: 12 },
  recordCard: { flexDirection: 'row', alignItems: 'center', padding: 13, gap: 11, marginBottom: 9 }, recordIcon: { width: 38, height: 38, borderRadius: 13, backgroundColor: C.mint, justifyContent: 'center', alignItems: 'center' }, recordGlyph: { color: C.green, fontSize: 20, fontWeight: '700' }, recordInfo: { flex: 1 }, recordName: { color: C.ink, fontSize: 13, fontWeight: '700', marginBottom: 2 }, recordRight: { alignItems: 'flex-end', gap: 5 }, recordAmount: { color: C.green, fontWeight: '800', fontSize: 13 }, editLink: { color: C.blue, fontSize: 10, fontWeight: '600' }, deleteLink: { color: C.red, fontSize: 10, fontWeight: '600' }, empty: { alignItems: 'center', paddingVertical: 22, gap: 6 }, emptyTitle: { color: C.ink, fontSize: 14, fontWeight: '700', textAlign: 'center' }, flowBalance: { borderTopWidth: 1, borderColor: C.border, marginTop: 15, paddingTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, flowBalanceAmount: { fontSize: 19, fontWeight: '800' },
  cardHeading: { color: C.ink, fontWeight: '750', fontSize: 15, marginBottom: 5 }, fieldWrap: { marginTop: 14 }, fieldLabel: { color: C.ink, fontSize: 11, fontWeight: '700', marginBottom: 7 }, input: { backgroundColor: '#F8F9F6', borderWidth: 1, borderColor: C.border, minHeight: 47, borderRadius: 12, paddingHorizontal: 12, color: C.ink, fontSize: 14 }, dateInput: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13 }, hint: { color: C.muted, fontSize: 10, lineHeight: 15, marginTop: 5 }, forecastRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, forecastAmount: { color: C.green, fontWeight: '800', fontSize: 17 }, questionInput: { minHeight: 72, textAlignVertical: 'top', paddingTop: 12, marginTop: 13, marginBottom: 10 }, answerBox: { borderRadius: 13, padding: 13, backgroundColor: C.canvas, marginTop: 13 }, answerText: { color: C.ink, fontSize: 12, lineHeight: 19 },
  authRoot: { flex: 1, backgroundColor: C.canvas }, authScroll: { flexGrow: 1, justifyContent: 'center', padding: 23, paddingTop: 54, paddingBottom: 30 }, authMark: { alignSelf: 'center', marginBottom: 13 }, authGlyph: { color: C.lime, fontSize: 36, fontWeight: '800' }, authTitle: { color: C.ink, fontSize: 23, lineHeight: 29, fontWeight: '800', textAlign: 'center', marginTop: 14 }, authSub: { color: C.muted, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 8, marginBottom: 19, paddingHorizontal: 12 }, authCard: { padding: 18, marginBottom: 12 }, authToggle: { alignItems: 'center', paddingVertical: 16 }, authToggleText: { color: C.green, fontSize: 12, fontWeight: '700' }, authFoot: { color: C.muted, textAlign: 'center', fontSize: 10, lineHeight: 15, paddingHorizontal: 8 },
  modalRoot: { flex: 1, backgroundColor: C.canvas }, modalHeader: { paddingTop: Platform.OS === 'ios' ? 28 : (StatusBar.currentHeight || 24) + 12, paddingHorizontal: 20, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.canvas }, modalEyebrow: { fontSize: 9, color: C.green, fontWeight: '800', letterSpacing: 1.1 }, modalTitle: { color: C.ink, fontSize: 21, fontWeight: '800', marginTop: 4 }, closeButton: { height: 36, width: 36, borderRadius: 13, backgroundColor: '#E8ECE6', alignItems: 'center', justifyContent: 'center' }, closeText: { color: C.ink, fontSize: 24, lineHeight: 27 }, modalContent: { paddingHorizontal: 20, paddingBottom: 30 }, categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, modalFoot: { color: C.muted, fontSize: 10, lineHeight: 15, marginTop: 14, textAlign: 'center' }, deletAccountBtn: { alignItems: 'center', paddingVertical: 18 }, deleteAccountText: { color: C.red, fontSize: 12, fontWeight: '600' }, historyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, marginBottom: 8 }, historyDate: { color: C.muted, fontSize: 12 }, historyRight: { alignItems: 'flex-end' }, historyAmount: { color: C.ink, fontWeight: '700', fontSize: 14 }, historyDelta: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  toast: { position: 'absolute', top: (StatusBar.currentHeight || 24) + 8, left: 16, right: 16, borderRadius: 12, padding: 14, zIndex: 999, elevation: 20 },
  toastText: { color: '#FFF', fontSize: 13, fontWeight: '600', textAlign: 'center' },
});

