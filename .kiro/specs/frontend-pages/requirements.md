# Requirements Document

## Introduction

This document defines the requirements for building the remaining frontend UI pages that connect the existing backend services (auth, dispatch, geo-dispatch, priority, stations, responders, disasters) to end users. The backend APIs are fully implemented and tested. The objective is to create Login, Admin Panel, Responder View, and wire the existing Dispatcher Command Center — so that the complete SOS-to-resolution lifecycle works end-to-end in production.

## Existing Components (already built)

- HomeScreen (survivor emergency buttons)
- QueueListView (local SOS records)
- CommandCenter (WebSocket + incident list + live map)
- IncidentQueue, IncidentDetailsPanel, DispatchPanel, LiveMap
- StationManagement, DisasterManagement, AuditTrailView, MetricsDashboard, SystemHealthPanel
- ProfileScreen, AdditionalInfoForm, SOSStatusDisplay, SOSTimelineView
- Auth service (JWT + refresh + MFA), useWebSocket hook

---

## Requirements

### Requirement 1: Login & Authentication Page

**User Story:** As any user (dispatcher, responder, administrator), I want to log in with my email and password so that I can access role-appropriate features.

#### Acceptance Criteria

1. THE application SHALL present a login page at `#/login` with email and password fields, a submit button, and a link back to the survivor home
2. WHEN a user submits valid credentials, THE application SHALL call `POST /api/auth/login`, store the returned access token in memory, and redirect based on role: `administrator` → `#/admin`, `dispatcher`/`supervisor` → `#/command-center`, `responder` → `#/responder`
3. IF the backend returns `mfaRequired: true`, THEN the application SHALL display a TOTP code input field before granting access
4. IF the backend returns `mfaSetupRequired: true`, THEN the application SHALL redirect to an MFA setup page showing a QR code (from `POST /api/auth/mfa/setup`) and require verification before proceeding
5. THE application SHALL store the access token in a React context (AuthContext) and attach it as `Authorization: Bearer <token>` to all authenticated API requests
6. WHEN the access token expires, THE application SHALL call `POST /api/auth/refresh` (using the HTTP-only cookie) transparently and retry the failed request
7. THE application SHALL provide a logout button that calls `POST /api/auth/logout` and redirects to `#/login`
8. IF the user is not authenticated and navigates to a protected route (`#/admin`, `#/command-center`, `#/responder`), THEN the application SHALL redirect to `#/login`

---

### Requirement 2: Admin Panel

**User Story:** As an administrator, I want a dashboard to manage regions, stations, responders, and disaster events so that the system can properly route SOS incidents.

#### Acceptance Criteria

1. THE admin panel at `#/admin` SHALL display a sidebar navigation with links to: Dashboard, Regions, Stations, Responders, Disasters, Audit Trail, System Health
2. THE Regions page SHALL allow creating a region with a name and boundary polygon (drawn on a map or entered as GeoJSON coordinates), calling `POST /api/regions` (to be added) with a `GEOMETRY(Polygon, 4326)` boundary
3. THE Stations page SHALL render the existing `StationManagement` component wired to the backend API at `/api/stations`, passing the auth token via fetch headers
4. THE Responders page SHALL list all responders (`GET /api/responders`), allow creating a responder (select user, assign station, set type), and show their current status and last known location
5. THE Disasters page SHALL render the existing `DisasterManagement` component wired to `/api/disasters`
6. THE Audit Trail page SHALL render the existing `AuditTrailView` component wired to `/api/audit`
7. THE System Health page SHALL render the existing `SystemHealthPanel` component wired to `/api/health` and the WebSocket `system:health` event
8. THE Dashboard page SHALL render the existing `MetricsDashboard` component with data from a `GET /api/metrics` endpoint (total incidents, avg response time, active responders, incidents by type)

---

### Requirement 3: Responder Mobile View

**User Story:** As a responder, I want to see assigned incidents, accept/decline dispatches, update my status, and share my location — all on a mobile-friendly interface.

#### Acceptance Criteria

1. THE responder view at `#/responder` SHALL display the responder's current status (available, busy, assigned, enRoute, onScene, offline) with a toggle to change between available and offline
2. WHEN a dispatch is assigned to the responder, THE application SHALL display a notification card with: emergency type, priority band, distance to incident, and Accept/Decline buttons
3. WHEN the responder taps Accept, THE application SHALL emit `responder:accept` via WebSocket and call `POST /api/sos/:id/enroute` to update the incident state
4. WHEN the responder taps Decline, THE application SHALL emit `responder:decline` via WebSocket
5. THE responder view SHALL show a mini-map with the incident location marked and the responder's current position, using Leaflet with OpenStreetMap tiles
6. THE application SHALL capture the responder's GPS location every 10 seconds while status is `enRoute` or `onScene` and emit `responder:location` via WebSocket
7. THE responder view SHALL provide buttons to update incident status: "Arrived" (`POST /api/sos/:id/arrived`) and "Resolved" (`POST /api/sos/:id/resolved`)
8. THE responder view SHALL listen for `dispatch:assigned` WebSocket events and display new assignments immediately

---

### Requirement 4: Command Center Dispatch Flow

**User Story:** As a dispatcher, I want to acknowledge incidents, view ranked responder suggestions, and assign a responder — so that SOS requests get timely responses.

#### Acceptance Criteria

1. WHEN a dispatcher clicks an incident in the IncidentQueue, THE application SHALL fetch incident details (`GET /api/sos/:id`) and display the existing `IncidentDetailsPanel` in the right panel
2. THE incident detail view SHALL include an "Acknowledge" button that calls `POST /api/sos/:id/ack` and updates the incident status to `acknowledged`
3. WHEN an incident is acknowledged, THE application SHALL fetch ranked responders from `GET /api/sos/:id/dispatch-options` (to be added) and display the existing `DispatchPanel`
4. WHEN a dispatcher selects a responder and clicks "Assign", THE application SHALL call `POST /api/sos/:id/dispatch` (to be added) which triggers the geo-dispatch engine to create the assignment and broadcast via WebSocket
5. THE Command Center SHALL display the incident status badge updating in real-time as state changes flow through WebSocket (`sos:stateChange`)
6. THE Command Center SHALL show responder locations updating in real-time on the LiveMap as `responder:locationUpdate` WebSocket events arrive

---

### Requirement 5: User Registration (Admin-Created)

**User Story:** As an administrator, I want to create user accounts for dispatchers, responders, and other staff so they can log in and use the system.

#### Acceptance Criteria

1. THE admin panel SHALL provide a "Create User" form with fields: name, email, password, role (dispatcher, supervisor, responder, auditor)
2. WHEN the form is submitted, THE application SHALL call `POST /api/users` (to be added) which hashes the password and inserts the user record
3. THE admin panel SHALL display a list of all users (`GET /api/users`) with their role, email, and MFA status
4. THE admin panel SHALL allow deactivating a user (soft delete or role change) but SHALL NOT allow deleting the last administrator

---

### Requirement 6: Survivor Status Tracking

**User Story:** As a survivor, I want to see real-time updates on my SOS request (acknowledged, help dispatched, responder en route) so that I know help is coming.

#### Acceptance Criteria

1. WHEN the survivor navigates to the Queue tab, THE application SHALL display each SOS record with its current status using the existing `SOSStatusDisplay` component
2. WHEN the survivor taps a delivered SOS record, THE application SHALL open the `SOSTimelineView` showing the full lifecycle history fetched from `GET /api/sos/:id/timeline`
3. THE survivor view SHALL establish a WebSocket connection (role: survivor, sessionId from IndexedDB) and listen for `sos:stateChange` events, updating the status display in real-time
4. WHEN the status changes to `enRoute`, THE application SHALL display the responder's name and type (from the WebSocket payload)
5. IF push notification permission was granted, THE application SHALL register for push notifications (`POST /api/push/subscribe`) so the survivor receives background updates even when the app is not focused

---

### Requirement 7: Region Management API

**User Story:** As an administrator, I want to create and manage geographic regions so that the geo-dispatch engine can route SOS incidents correctly.

#### Acceptance Criteria

1. THE backend SHALL expose `POST /api/regions` accepting: name (required), boundary (GeoJSON polygon coordinates, required), status (active/inactive, default active)
2. THE backend SHALL expose `GET /api/regions` returning all regions with id, name, status, and created_at
3. THE backend SHALL expose `PATCH /api/regions/:id` allowing updates to name, boundary, and status
4. THE backend SHALL validate that the boundary forms a valid closed polygon before inserting
5. THE admin panel Regions page SHALL display regions on a map with their boundaries drawn as polygons, allow drawing new boundaries interactively using Leaflet Draw, and show a form for the region name

---

### Requirement 8: Dispatch & Metrics API Endpoints

**User Story:** As a developer, I want the remaining API endpoints to exist so the frontend can complete the dispatch flow and display metrics.

#### Acceptance Criteria

1. THE backend SHALL expose `GET /api/sos/:id/dispatch-options` which calls the geo-dispatch ranking engine and returns the top 10 ranked responders with distance, type, freshness, and score
2. THE backend SHALL expose `POST /api/sos/:id/dispatch` accepting `responderId`, which assigns the responder, transitions the SOS to `dispatched`, broadcasts via WebSocket, and starts escalation timer
3. THE backend SHALL expose `GET /api/metrics` returning: total incidents (24h), average response time, active responders count, incidents by emergency type, and incidents by priority band
4. THE backend SHALL expose `POST /api/users` (admin-only) for creating user accounts with hashed passwords
5. THE backend SHALL expose `GET /api/users` (admin-only) for listing all user accounts

---

### Requirement 9: Protected Route Guards & Navigation

**User Story:** As a user, I want the app to route me correctly based on my role and prevent unauthorized access.

#### Acceptance Criteria

1. THE application SHALL implement an AuthContext provider wrapping the app that holds: current user (id, role, name, email), access token, isAuthenticated flag, login/logout/refresh functions
2. THE application SHALL implement a ProtectedRoute wrapper that checks isAuthenticated and redirects to `#/login` if false
3. THE application SHALL implement role-based route guards: `#/admin` requires `administrator`, `#/command-center` requires `dispatcher`/`supervisor`/`administrator`, `#/responder` requires `responder`
4. THE bottom navigation SHALL adapt based on authentication state: unauthenticated users see SOS + Queue + Login, authenticated users see role-appropriate links
5. THE application SHALL persist the refresh token via HTTP-only cookie (handled by backend) and attempt a silent refresh on app load to restore sessions

---

### Requirement 10: Push Notifications & Background Updates

**User Story:** As a survivor, I want to receive push notifications when my SOS status changes, even if the app is in the background.

#### Acceptance Criteria

1. THE application SHALL prompt for notification permission after the first SOS is delivered successfully (not on app load)
2. WHEN permission is granted, THE application SHALL subscribe via the Push API using the VAPID public key from the backend and register the subscription with `POST /api/push/subscribe`
3. THE Service Worker SHALL handle push events by displaying a notification with the SOS status update (title: "MeshSOS Update", body: status change description)
4. WHEN the user clicks the notification, THE application SHALL navigate to the relevant SOS timeline view
5. THE backend SHALL send push notifications to the survivor when their SOS transitions to: acknowledged, dispatched, enRoute, arrived, resolved

---