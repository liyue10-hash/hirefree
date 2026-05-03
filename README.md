# HireFree

Real Free Hire & Resume Platform.

## Start locally

```bash
npm install
npm start
```

## Admin login

Admin page is hidden at `/admin.html`. Do not show this link on the homepage.

Set these in Render Environment Variables:

```
ADMIN_EMAIL=your-admin-email@example.com
ADMIN_PASSWORD=your-strong-admin-password
ADMIN_RECOVERY_EMAIL=your-admin-email@example.com
ADMIN_RECOVERY_PHONE=+16043065431
SESSION_SECRET=change-this-secret
```

## Admin password recovery with two-step verification

Admin recovery page is `/admin-recovery.html`.

It sends one code by email and one code by SMS. Both codes are required to reset the admin password.

To send email, set SMTP variables:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-gmail-app-password
SMTP_FROM=HireFree Admin <your-email@gmail.com>
```

To send SMS, set Twilio variables:

```
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_FROM_NUMBER=+1xxxxxxxxxx
```

Then deploy to Render.
