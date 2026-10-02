with open('App.js', 'r', encoding='utf-8') as f:
    content = f.read()

old = "  const signOut = async () => { await SecureStore.deleteItemAsync('qlots-token'); setToken(null); setUser(null); setDashboard(null); setEntries([]); setHistory([]); setForecast(null); setAnswer(''); setAuth({ name: '', email: '', password: '' }); setAuthMode('login'); };"
new = "  const signOut = async () => { await SecureStore.deleteItemAsync('qlots-token'); setToken(null); setUser(null); setDashboard(null); setEntries([]); setHistory([]); setForecast(null); setAnswer(''); setAuth({ name: '', email: '', password: '' }); setAuthMode('login'); setPage('home'); };"

if old in content:
    content = content.replace(old, new, 1)
    print('page reset fix applied')
else:
    print('ERROR: pattern not found')

with open('App.js', 'w', encoding='utf-8') as f:
    f.write(content)
