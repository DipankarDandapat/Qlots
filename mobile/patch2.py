with open('App.js', 'r', encoding='utf-8') as f:
    content = f.read()

api_log_panel = '''
function ApiLogPanel({ onClose }) {
  const logs = useApiLogs();
  const [selected, setSelected] = useState(null);
  if (!NETWORK_LOG_ENABLED) return (
    <View style={{ flex: 1, backgroundColor: '#0D1F17', paddingTop: (StatusBar.currentHeight || 24) + 8, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#5A7A6A', textAlign: 'center', paddingHorizontal: 32, lineHeight: 22 }}>Network logging is disabled.{\'\\n\\n\'}Set EXPO_PUBLIC_NETWORK_LOG=true in .env and rebuild to enable.</Text>
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

'''

content = content.replace('function AuthScreen(', api_log_panel + 'function AuthScreen(', 1)

with open('App.js', 'w', encoding='utf-8') as f:
    f.write(content)

print('Done')
