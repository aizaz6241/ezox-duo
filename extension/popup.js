const ids = ['server', 'name', 'room', 'password'];
chrome.storage.local.get([...ids, 'enabled'], (c) => {
  ids.forEach((k) => (document.getElementById(k).value = c[k] || ''));
  document.getElementById('enabled').checked = c.enabled !== false;
});
document.getElementById('save').onclick = () => {
  const data = { enabled: document.getElementById('enabled').checked };
  ids.forEach((k) => (data[k] = document.getElementById(k).value.trim()));
  data.room = data.room.toLowerCase();
  chrome.storage.local.set(data, () => {
    document.getElementById('msg').textContent = 'Save ho gaya ✓ — Netflix tab khud connect ho jayega';
  });
};
