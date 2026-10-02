with open('App.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Also fix signOut to clear forecast
old = "  const signOut = async () => { await SecureStore.deleteItemAsync('qlots-token'); setToken(null); setUser(null); setDashboard(null); setEntries([]); setHistory([]); };"
new = "  const signOut = async () => { await SecureStore.deleteItemAsync('qlots-token'); setToken(null); setUser(null); setDashboard(null); setEntries([]); setHistory([]); setForecast(null); setAnswer(''); };"

if old in content:
    content = content.replace(old, new, 1)
    print('signOut fix applied')
else:
    print('signOut pattern not found')

with open('App.js', 'w', encoding='utf-8') as f:
    f.write(content)
