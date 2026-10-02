with open('App.js', 'r', encoding='utf-8') as f:
    content = f.read()

old = "  const signOut = async () => { await SecureStore.deleteItemAsync('qlots-token'); setToken(null); setUser(null); setDashboard(null); setEntries([]); setHistory([]); setForecast(null); setAnswer(''); setAuth({ name: '', email: '', password: '' }); setAuthMode('login'); setPage('home'); };"
new = "  const signOut = async () => { await SecureStore.deleteItemAsync('qlots-token'); setProfileModal(false); setPage('home'); setToken(null); setUser(null); setDashboard(null); setEntries([]); setHistory([]); setForecast(null); setAnswer(''); setAuth({ name: '', email: '', password: '' }); setAuthMode('login'); };"

if old in content:
    content = content.replace(old, new, 1)
    print('fix applied')
else:
    print('ERROR: pattern not found')
    # show what we have
    idx = content.find('const signOut')
    print(repr(content[idx:idx+200]))

with open('App.js', 'w', encoding='utf-8') as f:
    f.write(content)
