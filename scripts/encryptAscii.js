const fs = require('fs');
const path = require('path');
const { encrypt } = require('../utils/crypto');

const asciiContent = fs.readFileSync(path.join(__dirname, '../ascii.txt'), 'utf8');
const encrypted = encrypt(asciiContent);

fs.writeFileSync(
    path.join(__dirname, '../ascii.encrypted'),
    JSON.stringify(encrypted, null, 2)
);

console.log('ASCII art has been encrypted and saved to ascii.encrypted'); 