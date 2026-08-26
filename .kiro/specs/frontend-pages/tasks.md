# Implementation Plan:

## Overview

This plan builds the remaining frontend pages and backend endpoints to complete the MeshSOS end-to-end lifecycle. Tasks are ordered by dependency: backend APIs first (so frontend can consume them), then auth infrastructure, then UI pages, then integration.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1", "4", "5", "6"], "description": "Auth infrastructure + backend endpoints (parallel)" },
    { "wave": 2, "tasks": ["2", "3"], "description": "Login pages + route guards (depend on auth context)" },
    { "wave": 3, "tasks": ["7", "8", "9"], "description": "Admin panel + responder view + command center wiring" },
    { "wave": 4, "tasks": ["10", "11"], "description": "Survivor enhancements + push notifications" },
    { "wave": 5, "tasks": ["12"], "description": "Integration testing and deployment verification" }
  ]
}
```

## Tasks
- [x] 1. AuthContext & API Service Layer
  - [x] 1.1 Create fetch wrapper with auth headers and 401 refresh-retry logic
    - Create `frontend/src/services/api.ts` exporting `authFetch(url, options)` that attaches `Authorization: Bearer <token>` header
    - On 401 response: call `POST /api/auth/refresh`, if success retry original request with new token, if fail redirect to `#/login`
    - Export helper `getAuthHeaders()` for components that use custom fetch
    - _Requirements: 1.5, 1.6, 9.1_

  - [x] 1.2 Create AuthContext provider with login/logout/refresh
    - Create `frontend/src/context/AuthContext.tsx` with `AuthState` (user, accessToken, isAuthenticated, isLoading)
    - Implement `login(email, password)` calling `POST /api/auth/login` returning user + token
    - Implement `logout()` calling `POST /api/auth/logout`, clearing state, redirecting to `#/login`
    - Implement `refreshToken()` called on app mount to restore sessions from HTTP-only cookie
    - Wrap the app in `<AuthProvider>` in `main.tsx`
    - _Requirements: 1.2, 1.5, 1.6, 1.7, 9.1, 9.5_

  - [x] 1.3 Create ProtectedRoute component with role-based guards
    - Create `frontend/src/components/ProtectedRoute.tsx` accepting `allowedRoles: string[]`
    - If `isLoading` show spinner; if not authenticated redirect to `#/login`; if wrong role redirect to `#/`
    - _Requirements: 1.8, 9.2, 9.3_

- [x] 2. Login & MFA Pages
  - [x] 2.1 Create LoginPage component
    - Create `frontend/src/features/auth/LoginPage.tsx` with email/password form
    - On submit call `login()` from AuthContext
    - On success redirect based on role: administrator→`#/admin`, dispatcher/supervisor→`#/command-center`, responder→`#/responder`
    - Display error messages for invalid credentials
    - _Requirements: 1.1, 1.2_

  - [x] 2.2 Handle MFA verification flow
    - If login returns `mfaRequired: true`: show 6-digit TOTP input
    - On submit call `POST /api/auth/mfa/verify` with userId + code
    - On success: store token and redirect by role
    - _Requirements: 1.3_

  - [x] 2.3 Handle MFA setup flow
    - If login returns `mfaSetupRequired: true`: call `POST /api/auth/mfa/setup`
    - Display QR code (otpauth URI as image) and verification code input
    - On successful verification: complete login flow
    - _Requirements: 1.4_

- [x] 3. Route Guards & Navigation Enhancement
  - [x] 3.1 Enhance App.tsx with full route structure
    - Add routes: `#/login`, `#/admin`, `#/admin/:tab`, `#/responder`, `#/profile`
    - Wrap protected routes with ProtectedRoute component
    - Keep `#/` and `#/queue` as public routes
    - _Requirements: 9.2, 9.3_

  - [x] 3.2 Make bottom navigation adaptive based on auth state
    - Unauthenticated: show SOS, Queue, Login links
    - Authenticated survivor: show SOS, Queue, Profile
    - Authenticated dispatcher/admin: show Command, Admin, Profile
    - Authenticated responder: show Responder, Profile
    - _Requirements: 9.4_

- [x] 4. Backend: User Management Endpoints
  - [x] 4.1 Create user service (createUser, listUsers)
    - Create `backend/src/services/user.service.ts`
    - `createUser(name, email, password, role)`: hash password with bcrypt(12), INSERT into users, return user row
    - `listUsers()`: SELECT id, name, email, role, mfa_enabled, created_at FROM users ORDER BY created_at DESC
    - Validate: email uniqueness, role is valid enum, password minimum 8 chars
    - _Requirements: 8.4, 8.5_

  - [x] 4.2 Create user routes (POST/GET /api/users)
    - Create `backend/src/routes/user.routes.ts`
    - `POST /api/users`: requires authenticate + authorize('administrator'), validates body with zod, calls createUser
    - `GET /api/users`: requires authenticate + authorize('administrator'), calls listUsers
    - Mount at `/api/users` in `backend/src/index.ts`
    - _Requirements: 5.1, 5.2, 5.3, 8.4, 8.5_

- [x] 5. Backend: Region Management Endpoints
  - [x] 5.1 Create region service (createRegion, listRegions, updateRegion)
    - Create `backend/src/services/region.service.ts`
    - `createRegion(name, boundary)`: INSERT with ST_GeomFromGeoJSON(boundary), validate with ST_IsValid
    - `listRegions()`: SELECT with ST_AsGeoJSON(boundary) as boundary_geojson
    - `updateRegion(id, fields)`: PATCH name, boundary, status
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x] 5.2 Create region routes (POST/GET/PATCH /api/regions)
    - Create `backend/src/routes/region.routes.ts`
    - Zod validation for boundary as GeoJSON Polygon
    - Require administrator role for mutations
    - Mount at `/api/regions` in `backend/src/index.ts`
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 6. Backend: Dispatch & Metrics Endpoints
  - [x] 6.1 Add GET /api/sos/:id/dispatch-options route
    - In `backend/src/routes/sos.routes.ts` add route
    - Requires authenticate + authorize('sos:dispatch')
    - Fetch incident, call detectRegion + rankResponders from geo-dispatch service
    - Return top 10 ranked responders with distance, type, freshness, score
    - _Requirements: 4.3, 8.1_

  - [x] 6.2 Add POST /api/sos/:id/dispatch route
    - In `backend/src/routes/sos.routes.ts` add route
    - Body: { responderId: string }
    - Requires authenticate + authorize('sos:dispatch')
    - Call dispatch service to assign responder, transition to 'dispatched'
    - Broadcast dispatch:assigned via WebSocket
    - Start escalation timer
    - _Requirements: 4.4, 8.2_

  - [x] 6.3 Create metrics route (GET /api/metrics)
    - Create `backend/src/routes/metrics.routes.ts`
    - Queries: total incidents (24h), avg response time, active responders, by type, by priority
    - Require authenticate + authorize('metrics:read')
    - Mount at `/api/metrics` in `backend/src/index.ts`
    - _Requirements: 2.8, 8.3_

- [x] 7. Admin Panel UI
  - [x] 7.1 Create AdminPanel layout with sidebar navigation
    - Create `frontend/src/features/admin/AdminPanel.tsx`
    - Sidebar with links: Dashboard, Regions, Stations, Responders, Users, Disasters, Audit, Health
    - Content area renders sub-component based on hash fragment
    - Mobile: collapsible sidebar / hamburger menu
    - _Requirements: 2.1_

  - [x] 7.2 Wire existing admin components to backend with auth
    - StationManagement: pass `apiBaseUrl` from env config + auth fetch
    - DisasterManagement: wire to `/api/disasters` with auth headers
    - AuditTrailView: wire to `/api/audit` with auth headers
    - SystemHealthPanel: wire to `/api/health` + WebSocket
    - MetricsDashboard: wire to `GET /api/metrics` with auth headers
    - _Requirements: 2.3, 2.5, 2.6, 2.7, 2.8_

  - [x] 7.3 Create UserManagement component
    - Create `frontend/src/features/admin/UserManagement.tsx`
    - List users table (name, email, role, MFA status, created date)
    - "Create User" form: name, email, password, role dropdown
    - On submit call `POST /api/users` with auth headers
    - Deactivate button (PATCH role or soft-delete) — prevent deactivating last admin
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 7.4 Create ResponderManagement component
    - Create `frontend/src/features/admin/ResponderManagement.tsx`
    - List responders (GET /api/responders) with status badges, type, station name, last location time
    - "Create Responder" form: select user (dropdown from GET /api/users?role=responder), assign station, set type
    - Call `POST /api/responders` with auth headers
    - _Requirements: 2.4_

  - [x] 7.5 Create RegionManagement component with map polygon drawing
    - Create `frontend/src/features/admin/RegionManagement.tsx`
    - Install leaflet-draw: add to frontend/package.json
    - Display map with existing region boundaries drawn as polygons
    - Leaflet.Draw toolbar for creating new polygon boundaries
    - Region name input + Save button → POST /api/regions
    - Edit existing: click polygon → PATCH /api/regions/:id
    - _Requirements: 2.2, 7.5_

- [x] 8. Responder View
  - [x] 8.1 Create ResponderView component
    - Create `frontend/src/features/responder/ResponderView.tsx`
    - Header: responder name, status badge, available/offline toggle
    - Main area: shows current assignment or "No active assignments" idle state
    - Connect WebSocket with role='responder', userId from auth context
    - _Requirements: 3.1_

  - [x] 8.2 Implement dispatch assignment card with Accept/Decline
    - Listen for `dispatch:assigned` WebSocket event
    - Display card: emergency type icon, priority band, distance, Accept/Decline buttons
    - Accept: emit `responder:accept` via WebSocket + call `POST /api/sos/:id/enroute`
    - Decline: emit `responder:decline` via WebSocket, return to idle
    - _Requirements: 3.2, 3.3, 3.4, 3.8_

  - [x] 8.3 Implement GPS tracking and location sharing
    - When status is `enRoute` or `onScene`: start `navigator.geolocation.watchPosition` or 10s interval
    - Emit `responder:location` via WebSocket with { latitude, longitude, accuracy, timestamp }
    - Stop tracking when resolved or offline
    - _Requirements: 3.6_

  - [x] 8.4 Implement mini-map and status update buttons
    - Show Leaflet mini-map with incident marker (red) + responder position (blue, auto-updating)
    - "Arrived" button → `POST /api/sos/:id/arrived` (visible when enRoute)
    - "Resolved" button → `POST /api/sos/:id/resolved` (visible when arrived/onScene)
    - Update local state on success
    - _Requirements: 3.5, 3.7_

- [x] 9. Command Center Dispatch Wiring
  - [x] 9.1 Wire incident selection to details panel
    - On incident click in IncidentQueue: fetch `GET /api/sos/:id` with auth
    - Render IncidentDetailsPanel in a slide-over/drawer panel
    - Show "Acknowledge" button for incidents with status='delivered'
    - _Requirements: 4.1, 4.2_

  - [x] 9.2 Wire acknowledge → dispatch options → assign flow
    - "Acknowledge" calls `POST /api/sos/:id/ack` with auth
    - On success: fetch `GET /api/sos/:id/dispatch-options`
    - Render DispatchPanel with ranked responders
    - "Assign" calls `POST /api/sos/:id/dispatch` with selected responderId
    - Update incident status in local state
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.6_

- [x] 10. Survivor Status Tracking Enhancement
  - [x] 10.1 Wire delivered records to SOSTimelineView
    - In queue view: on tap of delivered/acknowledged/dispatched record, navigate to `#/queue/:id`
    - At that route: render SOSTimelineView with `sosId` and `isOnline` from connectivity state
    - Fetch timeline from `GET /api/sos/:id/timeline`
    - _Requirements: 6.1, 6.2_

  - [x] 10.2 Establish survivor WebSocket for real-time status updates
    - On app load (if any delivered SOS exists): connect WebSocket with role='survivor', sessionId
    - Listen for `sos:stateChange` events
    - Update local IndexedDB record status and re-render queue
    - Display responder info when status becomes `enRoute`
    - _Requirements: 6.3, 6.4_

  - [x] 10.3 Trigger push notification registration after first delivery
    - After SyncEngine successfully delivers first SOS (status → delivered)
    - Call `requestPermission()` from push-notification service
    - If granted: call `subscribe()` then `registerWithBackend()`
    - _Requirements: 10.1, 10.2_

- [x] 11. Push Notification Backend Triggers
  - [x] 11.1 Send push notifications on SOS state transitions
    - In workflow service (`markEnRoute`, `markArrived`, `markResolved`) and `acknowledgeSOS`:
    - After successful state transition, look up push subscriptions for the SOS user/session
    - Send web-push notification with title and state description
    - Non-blocking: errors don't fail the state transition
    - _Requirements: 10.3, 10.4, 10.5_

- [x] 12. Integration Testing & Build Verification
  - [x] 12.1 Verify full build passes (shared + frontend + backend)
    - Run `npm run build` from root — all three workspaces must succeed
    - Verify no TypeScript errors from new files
    - _Requirements: all_

  - [x] 12.2 Verify backend tests still pass
    - Run `npm run test:backend` — all existing tests must pass
    - New routes should not break existing functionality
    - _Requirements: all_

  - [x] 12.3 Push to GitHub and verify deployments
    - Commit all changes, push to main
    - Verify Railway backend deploys successfully
    - Verify Vercel frontend deploys successfully
    - Test login flow end-to-end with admin credentials
    - _Requirements: all_