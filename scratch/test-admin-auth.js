const admin = require('firebase-admin');
console.log('admin object keys:', Object.keys(admin));
try {
  console.log('admin.auth:', typeof admin.auth);
  const { getAuth } = require('firebase-admin/auth');
  console.log('getAuth:', typeof getAuth);
} catch (err) {
  console.error(err);
}
