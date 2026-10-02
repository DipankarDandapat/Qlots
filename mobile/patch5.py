with open('App.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix signOut to reset auth form and mode
old1 = "  const signOut = async () => { await SecureStore.deleteItemAsync('qlots-token'); setToken(null); setUser(null); setDashboard(null); setEntries([]); setHistory([]); setForecast(null); setAnswer(''); };"
new1 = "  const signOut = async () => { await SecureStore.deleteItemAsync('qlots-token'); setToken(null); setUser(null); setDashboard(null); setEntries([]); setHistory([]); setForecast(null); setAnswer(''); setAuth({ name: '', email: '', password: '' }); setAuthMode('login'); };"

if old1 in content:
    content = content.replace(old1, new1, 1)
    print('signOut fix applied')
else:
    print('ERROR: signOut pattern not found')

with open('App.js', 'w', encoding='utf-8') as f:
    f.write(content)
