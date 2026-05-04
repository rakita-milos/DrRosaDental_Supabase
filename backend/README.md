# Dr Rosa Backend API - Setup & Documentation

## Database Status

This backend now uses SQLite through Node's built-in `node:sqlite` module, not PostgreSQL.

Configure the database file in `.env`:

```env
SQLITE_DB_PATH=./data/drosa.sqlite
SQLITE_BACKUP_DIR=./backups
```

For a USB database, set an absolute path, for example:

```env
SQLITE_DB_PATH=E:\DrRosaData\drosa.sqlite
SQLITE_BACKUP_DIR=E:\DrRosaData\backups
```

The server automatically creates the database, schema, demo doctors, and demo users on first start.

Backup command:

```powershell
npm.cmd run backup
```

## 📋 Overview
Complete Node.js/Express backend with SQLite database for Dr Rosa Dental Clinic management system. Provides JWT authentication, patient management, visit records, and director reports.

## 🛠️ Installation

### Prerequisites
- Node.js 14+ ([Download](https://nodejs.org/))
- PostgreSQL 12+ ([Download](https://www.postgresql.org/))

### 1. Install Dependencies
```bash
cd backend
npm install
```

### 2. Create PostgreSQL Database
```bash
# Using psql command line
psql -U postgres
CREATE DATABASE drosa_clinic;
\c drosa_clinic
\i database.sql
```

Or using pgAdmin GUI:
1. Create new database: `drosa_clinic`
2. Right-click → Query Tool
3. Paste contents of `database.sql`
4. Execute

### 3. Configure Environment
Edit `.env` file with your database credentials:
```
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your-password
DB_NAME=drosa_clinic
JWT_SECRET=your-secret-key
```

### 4. Start Server
```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

Server will run on `http://localhost:3000`

---

## 🔐 Authentication

### Default Users
```
Email: director@drosa.com
Password: password123
Role: director

Email: staff@drosa.com  
Password: password123
Role: staff
```

### Login Process
1. POST `/api/auth/login` with email/password
2. Receive JWT token (valid 24 hours)
3. Include token in Authorization header: `Bearer <token>`

---

## 📚 API Endpoints

### Authentication

#### POST `/api/auth/login`
Login and get JWT token
```json
{
  "email": "director@drosa.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 1,
    "email": "director@drosa.com",
    "name": "Dr Rosa Bašić",
    "role": "director"
  }
}
```

#### POST `/api/auth/verify`
Verify JWT token validity
```
Headers: Authorization: Bearer <token>
```

---

### Patients

#### GET `/api/patients`
Get all patients
```
Headers: Authorization: Bearer <token>
```

**Response:**
```json
[
  {
    "id": 1,
    "first_name": "Marko",
    "last_name": "Horvat",
    "date_of_birth": "1990-05-15",
    "email": "marko@email.com",
    "phone": "+385-1-1234567",
    "address": "Ulica 123, Zagreb",
    "created_at": "2024-01-15T10:30:00Z"
  }
]
```

#### GET `/api/patients/:id`
Get patient details
```
Headers: Authorization: Bearer <token>
```

#### POST `/api/patients`
Create new patient
```json
{
  "first_name": "Marko",
  "last_name": "Horvat",
  "date_of_birth": "1990-05-15",
  "email": "marko@email.com",
  "phone": "+385-1-1234567",
  "address": "Ulica 123, Zagreb",
  "emergency_contact": "Ana Horvat"
}
```

#### PUT `/api/patients/:id`
Update patient
```json
{
  "phone": "+385-1-9999999",
  "address": "Nova adresa 456, Split"
}
```

---

### Visit Records

#### GET `/api/records`
Get all visit records with patient/doctor details and payment info
```
Headers: Authorization: Bearer <token>
```

**Response:**
```json
[
  {
    "id": 1,
    "patient_id": 1,
    "first_name": "Marko",
    "last_name": "Horvat",
    "doctor_id": 1,
    "doctor_name": "Dr Rosa Bašić",
    "visit_date": "2024-01-20",
    "procedure": "Kontrola",
    "status": "Završeno",
    "amount_due": 250.00,
    "payment_status": "Plaćeno",
    "notes": "Sve je u redu"
  }
]
```

#### POST `/api/records`
Create visit record with payment
```json
{
  "patient_id": 1,
  "doctor_id": 1,
  "visit_date": "2024-01-20",
  "procedure": "Kontrola",
  "status": "Završeno",
  "notes": "Sve je u redu",
  "amount": 250.00,
  "payment_status": "Plaćeno"
}
```

#### PUT `/api/records/:id`
Update visit record
```json
{
  "status": "Otkazano",
  "notes": "Pacijent otkazao"
}
```

---

### Doctors

#### GET `/api/doctors`
Get all doctors
```
Headers: Authorization: Bearer <token>
```

**Response:**
```json
[
  {
    "id": 1,
    "name": "Dr Rosa Bašić",
    "specialization": "General Dentistry",
    "email": "rosa@drosa.com",
    "phone": "+385-1-1234567"
  }
]
```

---

### Director Reports (Director only)

#### GET `/api/director/reports/financial`
Financial summary report
```
Headers: Authorization: Bearer <token>
```

**Response:**
```json
{
  "totalRevenue": 2500.00,
  "totalDebt": 750.00,
  "totalPatients": 8,
  "totalVisits": 10,
  "paymentPercentage": "76.9",
  "details": {
    "revenue": "2500.00",
    "debt": "750.00",
    "paidPercentage": "76.9"
  }
}
```

#### GET `/api/director/reports/patients`
Patient statistics
```
Headers: Authorization: Bearer <token>
```

**Response:**
```json
{
  "total": 8,
  "regular": 2,
  "new": 6
}
```

#### GET `/api/director/reports/doctors`
Doctor productivity report
```
Headers: Authorization: Bearer <token>
```

**Response:**
```json
[
  {
    "doctor": "Dr Rosa Bašić",
    "visits": 6,
    "percentage": 60.0
  },
  {
    "doctor": "Dr Novak Marković",
    "visits": 3,
    "percentage": 30.0
  },
  {
    "doctor": "Dr Horvat Ivo",
    "visits": 1,
    "percentage": 10.0
  }
]
```

#### GET `/api/director/reports/procedures`
Procedure statistics
```
Headers: Authorization: Bearer <token>
```

**Response:**
```json
[
  {
    "procedure": "Kontrola",
    "count": 4,
    "percentage": 40.0,
    "avgCost": 200.00
  },
  {
    "procedure": "Čišćenje",
    "count": 3,
    "percentage": 30.0,
    "avgCost": 150.00
  }
]
```

---

## 🔄 Testing with Frontend

### 1. Update Frontend Auth
In `src/scripts/login.js`, replace hardcoded users with API call:

```javascript
async function loginUser(email, password) {
  const response = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

  if (response.ok) {
    const data = await response.json();
    localStorage.setItem('drrosa-token', data.token);
    localStorage.setItem('drrosa-user', JSON.stringify(data.user));
    return data.user;
  }
  throw new Error('Login failed');
}
```

### 2. Update API Calls
Replace localStorage reads with fetch requests:

```javascript
const token = localStorage.getItem('drrosa-token');
const response = await fetch('http://localhost:3000/api/records', {
  headers: { 'Authorization': `Bearer ${token}` }
});
const records = await response.json();
```

### 3. Enable CORS
Update `.env`:
```
CORS_ORIGIN=http://localhost:3000,file://
```

---

## 📊 Database Schema

### Tables
- **users** - Authentication (director, staff)
- **patients** - Patient information
- **doctors** - Doctor profiles
- **visit_records** - Appointments and procedures
- **payments** - Payment tracking
- **treatments** - Detailed treatment records

### Key Relationships
- patients → visit_records → doctors
- visit_records → payments
- visit_records → treatments

---

## 🔧 Development

### Common Tasks

**Reset Database:**
```bash
dropdb drosa_clinic
createdb drosa_clinic
psql drosa_clinic < database.sql
```

**Add New Endpoint:**
1. Create route in `server.js`
2. Add database query
3. Return JSON response
4. Test with curl or Postman

**Change Database Credentials:**
1. Edit `.env`
2. Restart server

---

## 🚨 Error Handling

All endpoints return standard error responses:

```json
{
  "error": "Invalid email or password"
}
```

Status codes:
- 200: Success
- 201: Created
- 400: Bad request
- 401: Unauthorized
- 403: Forbidden (wrong role)
- 404: Not found
- 500: Server error

---

## 🔒 Security

- Passwords hashed with bcryptjs
- JWT tokens expire after 24 hours
- Role-based access control on protected endpoints
- CORS restricted to frontend origins
- SQL injection prevented with parameterized queries

---

## 📝 Troubleshooting

**Database Connection Failed:**
- Check PostgreSQL is running
- Verify credentials in `.env`
- Test: `psql -U postgres -h localhost`

**Token Expired:**
- Re-login to get new token
- Token lasts 24 hours

**CORS Error:**
- Update `CORS_ORIGIN` in `.env`
- Restart server

**Port Already in Use:**
- Change `PORT` in `.env`
- Or kill process: `lsof -ti:3000 | xargs kill -9`

---

## 📞 Support
For API issues, check:
1. Correct authorization header format
2. Token not expired
3. User has required role
4. Database connection

Next Step: Update frontend to use API endpoints instead of localStorage.
