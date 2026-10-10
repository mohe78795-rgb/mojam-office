#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."
cp .env.example .env
read -r -p 'الصق رابط MongoDB الجديد: ' MONGODB_URI
read -r -p 'الصق مفتاح Gemini الجديد: ' GEMINI_API_KEY
read -r -p 'الصق مفتاح Groq الجديد: ' GROQ_API_KEY
read -r -p 'اكتب JWT_SECRET طويلًا: ' JWT_SECRET
read -r -p 'اكتب كلمة مرور المدير: ' ADMIN_PASSWORD
python3 - "$MONGODB_URI" "$GEMINI_API_KEY" "$GROQ_API_KEY" "$JWT_SECRET" "$ADMIN_PASSWORD" <<'PY'
from pathlib import Path
import sys
p=Path('.env')
s=p.read_text()
vals={'MONGODB_URI':sys.argv[1], 'GEMINI_API_KEY':sys.argv[2], 'GROQ_API_KEY':sys.argv[3], 'JWT_SECRET':sys.argv[4], 'ADMIN_PASSWORD':sys.argv[5]}
for k,v in vals.items():
    lines=[f'{k}={v}' if line.startswith(k+'=') else line for line in s.splitlines()]
    s='\n'.join(lines)+'\n'
p.write_text(s)
PY
chmod 600 .env
printf '%s\n' 'تم إنشاء server/.env محليًا. لا ترفعه إلى GitHub ولا ترسله في الرسائل.'
