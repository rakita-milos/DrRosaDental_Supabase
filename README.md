# Dr Rosa Dental Dashboard

A modern dental clinic management system with role-based access control, patient tracking, financial reporting, and director-only analytics dashboard.

## 🎯 Features

✅ **Staff Interface**
- Patient dashboard with visit history
- Treatment logging with tooth mapping (FDI numbering)
- Payment tracking (Plaćeno, Delimično, Dugovanje)
- Patient filtering and search
- Individual patient profiles

✅ **Director Panel** (Director-only section)
- Financial reports (revenue, debt, payment status)
- Patient analytics (growth, retention, visit frequency)
- Doctor productivity tracking
- Procedure distribution analysis

✅ **Security**
- Role-based access control (Director/Staff)
- Session-based authentication
- Automatic logout and login redirects
- Protected URLs

## 📁 Project Structure

```
DrRosaWebApp/
├── index.html                          # Root file (redirects to src/pages)
├── README.md                           # This file
├── DIRECTOR_PANEL_GUIDE.md            # Complete director panel documentation
└── src/
    ├── pages/
    │   ├── login.html                 # Login page (entry point)
    │   ├── index.html                 # Staff dashboard
    │   ├── new-entry.html             # Create new visit record
    │   ├── all-records.html           # View all patients
    │   ├── patient-dashboard.html     # Individual patient view
    │   ├── new-patient.html           # Register new patient
    │   └── director-panel.html        # DIRECTOR ONLY - Reports
    ├── styles/
    │   └── styles.css                 # Global responsive styling
    ├── scripts/
    │   ├── login.js                   # Authentication logic
    │   ├── script.js                  # Dashboard rendering
    │   ├── new-entry.js               # Visit record form
    │   ├── all-records.js             # Patient list filtering
    │   ├── patient-dashboard.js       # Patient detail view
    │   ├── new-patient.js             # Patient registration
    │   └── director-reports.js        # Director panel reports
    └── assets/
        └── logo.svg                   # Brand logo
```

## 🚀 Quick Start

### 1. Start HTTP Server
```bash
cd c:\Users\milos\DrRosaWebApp
python -m http.server 8000
```

### 2. Open in Browser
Navigate to: `http://localhost:8000/src/pages/login.html`

### 3. Demo Credentials

**Director Access:**
- Email: `director@drosa.com`
- Password: `director123`
- Role: Direktor Ordinacije
- Access: Director panel with all reports

**Staff Access:**
- Email: `staff@drosa.com`
- Password: `staff123`
- Role: Zaposlenik
- Access: Patient dashboard, new entries, records

## 🔐 Authentication System

### How It Works
1. User submits credentials on `login.html`
2. `login.js` validates against demo user database
3. Session saved to `localStorage['drrosa-session']` with role
4. Redirect based on role:
   - Director → `director-panel.html`
   - Staff → `index.html` (dashboard)
5. All pages validate session on load
   - Valid session + correct role → Allow access
   - Invalid/missing session → Redirect to login
   - Wrong role (e.g., staff accessing director panel) → Redirect to login

### Session Object
```json
{
  "email": "director@drosa.com",
  "name": "Dr Rosa Bašić",
  "role": "director",
  "loginTime": "2026-05-03T19:39:40.254Z"
}
```

## 📊 Director Panel Reports

**4 Comprehensive Reports Available:**

1. **Finansijski Izvještaj** (Financial Report)
   - Total revenue, outstanding debt, payment percentage
   - Payment breakdown by patient with amount and status

2. **Pacijenti** (Patients Report)
   - Total patients, regular vs new patients
   - Visit frequency and payment status per patient
   - Retention metrics

3. **Doktori** (Doctors Report)
   - Workload distribution across doctors
   - Patient count per doctor
   - Productivity percentages

4. **Postupci** (Procedures Report)
   - Procedure frequency and percentages
   - Average payment per procedure type
   - Service mix analysis

**See [DIRECTOR_PANEL_GUIDE.md](DIRECTOR_PANEL_GUIDE.md) for detailed documentation.**

## 💾 Data Persistence

All data stored in browser `localStorage`:

- `drrosa-session` — Current user session
- `drrosa-records` — All visit records with payment status
- `drrosa-patients` — Patient registry with contact info

**Example Record:**
```javascript
{
  patient: "Ana Kovač",
  lastVisit: "2026-04-28",
  procedure: "Kontrola i čišćenje",
  status: "Zakazano",
  doctor: "Dr Rosa",
  paymentStatus: "Plaćeno",
  amountDue: 50
}
```

## 🎨 Design Features

- **Responsive Layout**: Mobile-first design with Flexbox/Grid
- **Gradient Color System**: Brand-inspired blue and green gradients
- **Status Colors**: 
  - 🟢 Plaćeno (Paid)
  - 🟡 Delimično (Partial)
  - 🔴 Dugovanje (Debt)
  - 🔵 Zakazano (Scheduled)
- **Interactive Tooth Map**: FDI numbering system for treatment mapping
- **Dark/Light Text**: Accessible contrast ratios
- **SVG Logo**: Scalable brand asset

## 🔧 Technologies

- **HTML5** — Semantic markup with accessibility
- **CSS3** — Flexbox, Grid, gradients, media queries
- **Vanilla JavaScript** — No dependencies, pure ES6+
- **localStorage API** — Client-side data persistence
- **SVG** — Interactive tooth mapping

## 📝 Notes

- Application uses demo data and localStorage (no backend server)
- All data is cleared when browser cache is cleared
- For production: Replace localStorage with real database
- Currently supports 2 demo users; expand in `login.js`

## 🚀 Future Enhancements

- [ ] Backend API integration (Node.js/Python)
- [ ] Real database (PostgreSQL/MongoDB)
- [ ] PDF export for reports
- [ ] Email report delivery
- [ ] Charts and graphs (Chart.js)
- [ ] Calendar interface
- [ ] Billing/Invoice system
- [ ] Two-factor authentication
- [ ] Audit logging
- [ ] User management for staff

## 📞 Support

For documentation on Director Panel features, see [DIRECTOR_PANEL_GUIDE.md](DIRECTOR_PANEL_GUIDE.md)

---

**Version:** 2.1 (Frontend/API integration pass)  
**Last Updated:** Maj 2026  
**Status:** Demo with backend integration; production hardening still required
