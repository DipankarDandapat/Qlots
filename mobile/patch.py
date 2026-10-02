import re

with open('App.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix 1: Add deleteConfirmVisible state before doDeleteAccount
old1 = '  const doDeleteAccount = async () => {'
new1 = '  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);\n  const doDeleteAccount = async () => {'
content = content.replace(old1, new1, 1)

# Fix 2: Replace API log modal with full request/response viewer
old2 = '''      <View style={{ flex: 1, backgroundColor: '#0D1F17', paddingTop: (StatusBar.currentHeight || 24) + 8 }}>

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderColor: '#1A3D2E' }}>
          <Text style={{ color: '#C8E8A9', fontWeight: '800', fontSize: 16 }}>API Log</Text>
          <Pressable onPress={() => setShowApiLog(false)} style={{ padding: 8 }}><Text style={{ color: '#7ECBA1', fontSize: 22 }}>A-</Text></Pressable>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, gap: 6 }}>
          {apiLogs.length === 0 && <Text style={{ color: '#5A7A6A', textAlign: 'center', marginTop: 40 }}>No requests yet</Text>}
          {apiLogs.map((log, i) => (

            <View key={i} style={{ backgroundColor: '#1A3D2E', borderRadius: 8, padding: 10 }}>

              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>

                <Text style={{ color: log.status >= 400 || log.status === 'ERR' ? '#F4A89A' : '#C8E8A9', fontWeight: '700', fontSize: 11 }}>{log.method} {log.path}</Text>
                <Text style={{ color: log.status >= 400 || log.status === 'ERR' ? '#F4A89A' : '#7ECBA1', fontSize: 11 }}>{log.status} Aú {log.ms}ms</Text>
              </View>
              <Text style={{ color: '#5A7A6A', fontSize: 10, marginTop: 2 }}>{log.time}</Text>
              {log.error ? <Text style={{ color: '#F4A89A', fontSize: 10, marginTop: 3 }}>{log.error}</Text> : null}
            </View>

          ))}
        </ScrollView>
      </View>'''

new2 = '''      <ApiLogPanel onClose={() => setShowApiLog(false)} />'''

content = content.replace(old2, new2, 1)

# Fix 3: Pass setDeleteConfirmVisible to ProfileModal
old3 = '<ProfileModal visible={profileModal} onClose={() => setProfileModal(false)} profile={profile} setProfile={setProfile} onSave={saveProfile} onDeleteAccount={doDeleteAccount} onSignOut={signOut} busy={busy} user={user} />'
new3 = '<ProfileModal visible={profileModal} onClose={() => setProfileModal(false)} profile={profile} setProfile={setProfile} onSave={saveProfile} onDeleteAccount={() => setDeleteConfirmVisible(true)} onSignOut={signOut} busy={busy} user={user} />\n    <Modal visible={deleteConfirmVisible} transparent animationType="fade" onRequestClose={() => setDeleteConfirmVisible(false)}>\n      <Pressable style={{ flex: 1, backgroundColor: \'rgba(0,0,0,0.5)\', justifyContent: \'center\', padding: 24 }} onPress={() => setDeleteConfirmVisible(false)}>\n        <Pressable style={{ backgroundColor: C.card, borderRadius: 20, padding: 24 }} onPress={() => {}}>\n          <Text style={{ color: C.ink, fontWeight: \'800\', fontSize: 18, marginBottom: 10 }}>Delete account?</Text>\n          <Text style={{ color: C.muted, fontSize: 14, lineHeight: 21, marginBottom: 24 }}>This will permanently delete your account and all your financial data. This cannot be undone.</Text>\n          <Pressable onPress={doDeleteAccount} style={{ backgroundColor: C.red, borderRadius: 12, padding: 14, alignItems: \'center\', marginBottom: 10 }}>\n            <Text style={{ color: \'#FFF\', fontWeight: \'700\', fontSize: 14 }}>Yes, delete everything</Text>\n          </Pressable>\n          <Pressable onPress={() => setDeleteConfirmVisible(false)} style={{ backgroundColor: C.mint, borderRadius: 12, padding: 14, alignItems: \'center\' }}>\n            <Text style={{ color: C.green, fontWeight: \'700\', fontSize: 14 }}>Cancel</Text>\n          </Pressable>\n        </Pressable>\n      </Pressable>\n    </Modal>'
content = content.replace(old3, new3, 1)

with open('App.js', 'w', encoding='utf-8') as f:
    f.write(content)

print('Done')
