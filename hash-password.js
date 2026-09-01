// Run with: npm run hash-password
// Prompts for a password and prints the value to paste into .env as ADMIN_PASSWORD_HASH.
const readline = require('readline');
const { hashPassword } = require('./auth');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Choose an admin password: ', (password) => {
  if (!password || password.length < 8) {
    console.error('Please use a password of at least 8 characters.');
    rl.close();
    process.exit(1);
  }
  const hashed = hashPassword(password);
  console.log('\nAdd this line to your .env file:\n');
  console.log(`ADMIN_PASSWORD_HASH=${hashed}\n`);
  rl.close();
});
