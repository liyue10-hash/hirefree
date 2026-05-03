# HireFree Admin Dashboard Version

## Run locally
1. Install Node.js LTS.
2. Double-click `start-windows.bat` on Windows, or run `./start-mac-linux.sh` on Mac/Linux.
3. Open http://localhost:3000

## Admin Dashboard
Open: http://localhost:3000/admin.html

Default admin login:
- Email: hr@ameleco.com
- Password: admin123

For production, set Render environment variables:
- ADMIN_EMAIL
- ADMIN_PASSWORD
- SESSION_SECRET

## Deploy on Render
Build Command: `npm install`
Start Command: `node server.js`
