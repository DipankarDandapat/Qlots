with open('App.js', 'r', encoding='utf-8') as f:
    content = f.read()

old = "      await SecureStore.setItemAsync('qlots-token', result.access_token);\n      setToken(result.access_token); setUser(result.user);\n      try { await refresh(result.access_token); } catch (_) {}"

new = "      await SecureStore.setItemAsync('qlots-token', result.access_token);\n      // Clear all previous user data before loading new user's data\n      setDashboard(null); setEntries([]); setHistory([]); setForecast(null);\n      setToken(result.access_token); setUser(result.user);\n      try { await refresh(result.access_token); } catch (_) {}"

if old in content:
    content = content.replace(old, new, 1)
    print('Login fix applied')
else:
    print('ERROR: pattern not found')

with open('App.js', 'w', encoding='utf-8') as f:
    f.write(content)
