# Implementation Plan: Emergency SOS Platform (MeshSOS)

## Overview

This plan implements an offline-first PWA emergency response platform with three applications (Survivor PWA, Responder PWA, Command Center) backed by a Node.js/Express + PostgreSQL server. Implementation follows a bottom-up approach: shared types and database schema first, then backend services, followed by frontend features starting with the critical SOS path.

## Tasks

- [x] 1. Project scaffolding and shared type definitions
  - [x] 1.1 Initialize monorepo structure with Vite React+TypeScript frontend and Node.js/Express backend
    - Create directory structure matching the design (src/features, src/services, src/db, src/workers, backend/src/services)
    - Configure Vite with PWA plugin, TypeScript strict mode, Tailwind CSS, and Vitest
    - Configure Express with TypeScript, ESLint, and Vitest for backend
    - Set up shared types package or directory
    - _Requirements: 46.1, 46.2_

  - [x] 1.2 Define all shared TypeScript types and interfaces
    - Create types for SOSStatus, EmergencyType, PriorityBand, ResponderStatus, AuditEventType
    - Define SOSRecord, LocalSOSRecord, LocalProfile, ConnectivityState, SendResult interfaces
    - Define LocationResult, IncidentAlert, RankedResponder, AuditEvent interfaces
    - Define WebSocket event types (server→client and client→server)
    - Define valid state transitions map (VALID_TRANSITIONS)
    - _Requirements: 1.2, 3.1, 10.1, 19.1, 20.1, 40.1_

  - [x] 1.3 Set up PostgreSQL schema with PostGIS and seed migration
    - Create migration files for all tables: users, regions, stations, responders, sos_incidents, sos_events, audit_trail, disaster_events, push_subscriptions, sessions
    - Enable PostGIS extension, create GIST indexes on geometry columns
    - Create indexes on status, region, priority, and timestamp columns
    - Add CHECK constraints for role, status, and type enumerations
    - _Requirements: 29.1, 27.4, 36.1, 40.4_

  - [x] 1.4 Write property test for SOS state machine transitions
    - **Property 10: State Machine Enforcement**
    - Generate random (currentState, targetState) pairs and verify only valid transitions are accepted
    - **Validates: Requirements 10.1**

- [x] 2. Backend authentication and authorization service
  - [x] 2.1 Implement JWT authentication with secure HTTP-only refresh cookies
    - Create auth middleware for token verification
    - Implement login, logout, refresh token endpoints
    - Implement session management (create, list, revoke)
    - Set secure cookie attributes (HttpOnly, Secure, SameSite)
    - Enforce session expiry after configurable inactivity period
    - _Requirements: 37.1, 37.3, 37.4, 38.7_

  - [x] 2.2 Implement MFA for privileged roles (Dispatcher, Supervisor, Administrator)
    - Add MFA verification step for Dispatcher/Supervisor/Administrator login
    - Store MFA configuration per user
    - Reject access without MFA completion for privileged roles
    - _Requirements: 37.2_

  - [x] 2.3 Implement RBAC middleware and permission enforcement
    - Define permission scopes per role (Survivor, Responder, Dispatcher, Supervisor, Administrator, Auditor)
    - Create authorization middleware that checks role permissions before handler execution
    - Return 403 with audit logging on unauthorized access attempts
    - Apply new permissions within 60 seconds of role change
    - _Requirements: 36.1, 36.2, 36.3, 36.4, 36.5_

  - [x] 2.4 Write property tests for RBAC enforcement
    - **Property 25: RBAC Enforcement**
    - Generate random (role, action, resource) triples and verify permission decisions match the defined scopes
    - **Validates: Requirements 36.1, 36.3, 36.4**

  - [x] 2.5 Write property test for MFA requirement
    - **Property 36: MFA Requirement for Privileged Roles**
    - Generate random authentication attempts for various roles and verify MFA is required for Dispatcher/Supervisor/Administrator
    - **Validates: Requirements 37.2**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Backend SOS service and audit trail
  - [x] 4.1 Implement SOS REST API endpoints
    - POST /api/sos — create new SOS with UUID, location, emergency type, timestamp
    - GET /api/sos/:id — retrieve SOS details
    - PATCH /api/sos/:id — update SOS (additional info: people count, situation type, description)
    - GET /api/sos/:id/timeline — get SOS event timeline ordered chronologically
    - GET /api/sos/history — get survivor's SOS history
    - POST /api/sos/:id/ack — dispatcher acknowledge SOS
    - Enforce valid state transitions, return 409 on invalid transitions
    - _Requirements: 1.2, 10.1, 10.4, 12.3, 45.1, 45.2_

  - [x] 4.2 Implement Audit Service (append-only audit trail)
    - Create AuditService with record() and query() methods
    - Record events for: SOS state transitions, dispatch decisions, responder assignments, overrides, escalations, auth events, role changes, config changes
    - Include entity ID, event type, actor ID, UTC timestamp (ms precision), previous/new state, metadata
    - Implement append-only enforcement — no UPDATE/DELETE on audit_trail table
    - Reject originating operation if audit persistence fails
    - Implement paginated query with filters (SOS ID, actor ID, event type, time range), max 100 per page
    - _Requirements: 40.1, 40.2, 40.3, 40.4, 40.5, 40.6_

  - [x] 4.3 Write property tests for audit trail
    - **Property 11: Audit Trail Completeness**
    - Generate random operations (state transitions, assignments, auth events) and verify audit records are created with all required fields
    - **Validates: Requirements 10.4, 19.3, 21.3, 40.1, 40.2, 40.3**

  - [x] 4.4 Write property test for audit immutability
    - **Property 12: Audit Immutability**
    - Generate random audit records, persist them, then verify no modification or deletion is possible and that failed audit persistence rejects the operation
    - **Validates: Requirements 40.4, 40.5**

  - [x] 4.5 Write property test for audit query pagination
    - **Property 32: Audit Query Pagination**
    - Generate random query parameters and verify results are filtered correctly, ordered by timestamp, and paginated to max 100 records
    - **Validates: Requirements 40.6**

- [x] 5. Backend Geo Dispatch Engine
  - [x] 5.1 Implement region detection using PostGIS ST_Contains
    - Query regions table with ST_Contains(boundary, point) for SOS GPS coordinates
    - Return region ID on match, assign "unresolved region" if no match
    - Handle missing/invalid GPS by assigning "unresolved location" status
    - Complete region detection within 2 seconds
    - _Requirements: 29.1, 29.2, 29.3, 29.4_

  - [x] 5.2 Implement emergency-type responder routing
    - Route Police/Rescue → police officers, rescue teams, disaster response
    - Route Medical → ambulances, medical responders, hospitals
    - Route Food/Water → relief teams, local administration, distribution centers
    - Route Children/Elderly → social-response teams, police, medical services
    - _Requirements: 30.1, 30.2, 30.3, 30.4_

  - [x] 5.3 Implement responder ranking algorithm
    - Filter out Busy/Offline responders
    - Flag responders with location freshness > staleness threshold (default 5 min)
    - Calculate Haversine distance from incident to each responder
    - Score = weighted sum: inverse distance (40%), type match (25%), freshness (20%), jurisdiction match (15%)
    - Sort descending by score, break ties by most recent location update
    - Return top 10 ranked responders
    - _Requirements: 31.1, 31.2, 31.3, 31.4, 31.5, 31.6, 32.1, 32.2_

  - [x] 5.4 Implement dispatch escalation chain
    - Track acknowledgment timeout per dispatch (configurable by priority band)
    - Escalate to next ranked responder on timeout
    - Escalate to station dispatcher if all individuals fail
    - Escalate to supervisor if station dispatcher doesn't respond
    - Log all escalation attempts in audit trail
    - _Requirements: 33.1, 33.2, 33.3, 33.4_

  - [x] 5.5 Write property tests for region detection
    - **Property 20: Region Detection**
    - Generate random GPS coordinates within and outside defined boundaries, verify correct region assignment or "unresolved" status
    - **Validates: Requirements 29.1, 29.3**

  - [x] 5.6 Write property tests for emergency-type routing
    - **Property 19: Emergency-Type Routing**
    - Generate random emergency types with region data and verify routing to correct responder pools
    - **Validates: Requirements 30.1, 30.2, 30.3, 30.4**

  - [x] 5.7 Write property tests for responder ranking
    - **Property 21: Responder Ranking Constraints**
    - Generate random sets of responders with varying statuses, locations, and freshness; verify filtering, ranking, tie-breaking, and max 10 results
    - **Validates: Requirements 31.1, 31.2, 31.3, 31.6**

  - [x] 5.8 Write property test for location freshness calculation
    - **Property 22: Location Freshness Calculation**
    - Generate random responder timestamps and verify freshness = elapsed time since update, and threshold flagging behavior
    - **Validates: Requirements 32.1, 32.2**

  - [x] 5.9 Write property test for escalation chain
    - **Property 23: Escalation Chain Progression**
    - Generate random dispatch scenarios with varying acknowledgment outcomes and verify correct escalation path
    - **Validates: Requirements 33.1, 33.2, 33.3**

- [x] 6. Backend Priority Engine and Deduplication
  - [x] 6.1 Implement Priority Engine scoring
    - Calculate score from factors: Medical +40, Vulnerable +25, 5+ people +20, wait >15min +15, high-risk zone +20
    - Cap total score at 100
    - Assign bands: 81–100 Critical, 61–80 High, 31–60 Medium, 0–30 Low
    - Handle missing data by scoring only available factors
    - Recalculate on data updates within 5 seconds
    - _Requirements: 35.1, 35.2, 35.3, 35.4, 35.5_

  - [x] 6.2 Implement SOS deduplication detection
    - Check for duplicates using device/session ID, location proximity, timestamp proximity, emergency category
    - Flag as "possible duplicate" for dispatcher review — never auto-discard
    - _Requirements: 34.1, 34.2_

  - [x] 6.3 Write property test for priority score calculation
    - **Property 24: Priority Score Calculation**
    - Generate random combinations of priority factors and verify score calculation, capping, and band assignment
    - **Validates: Requirements 35.1, 35.2, 35.3**

  - [x] 6.4 Write property test for deduplication detection
    - **Property 26: Deduplication Detection**
    - Generate pairs of SOS records with varying similarity and verify detection of duplicates without auto-discard
    - **Validates: Requirements 34.1, 34.2**

- [x] 7. Checkpoint - Ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Backend WebSocket and notification services
  - [x] 8.1 Implement Socket.IO event broadcasting
    - Set up Socket.IO rooms: command-center, responder:{id}, survivor:{sessionId}, region:{regionId}
    - Implement server→client events: sos:created, sos:updated, sos:stateChange, responder:locationUpdate, responder:statusChange, dispatch:assigned, system:health
    - Implement client→server events: responder:accept, responder:decline, responder:location
    - Broadcast state changes within 2 seconds
    - _Requirements: 43.1, 43.2, 43.3_

  - [x] 8.2 Implement Web Push notification service
    - Send push notifications on SOS state transitions (Delivered, Acknowledged, Dispatched, En Route, Arrived, Resolved)
    - Include SOS identifier and status message in notification payload
    - Send within 5 seconds of state transition
    - Handle expired/invalid subscriptions (mark inactive, stop retry)
    - _Requirements: 11.1, 11.4, 11.5_

  - [x] 8.3 Implement emergency contact notification
    - Send notification to configured emergency contact when SOS received by backend
    - Include survivor name and fact of emergency request creation
    - _Requirements: 14.1, 14.2_

  - [x] 8.4 Write property test for notification content
    - **Property 38: Notification Content Completeness**
    - Generate random SOS state transitions and verify notification payload contains SOS ID and status message
    - **Validates: Requirements 11.4**

- [x] 9. Backend security controls
  - [x] 9.1 Implement rate limiting, input validation, and security headers
    - Add rate limiting middleware on all API endpoints (with SOS creation per-device limits)
    - Implement input validation and sanitization for all request bodies
    - Set security headers: Content-Security-Policy, X-Frame-Options, X-Content-Type-Options, Strict-Transport-Security
    - Implement XSS protection through output encoding
    - Implement CSRF protection for state-changing requests
    - _Requirements: 38.1, 38.2, 38.3, 38.4, 38.5, 38.6, 39.1_

  - [x] 9.2 Implement suspicious behavior detection and false SOS protection
    - Detect rapid repeated submissions, impossible location changes
    - Flag suspicious SOS for dispatcher review without blocking
    - _Requirements: 39.2, 39.3_

  - [x] 9.3 Write property test for suspicious behavior detection
    - **Property 31: Suspicious Behavior Detection**
    - Generate random SOS submission patterns and verify suspicious patterns are flagged for review without blocking
    - **Validates: Requirements 39.2, 39.3**

- [x] 10. Backend station and facility management
  - [x] 10.1 Implement CRUD endpoints for stations, hospitals, and relief centers
    - Create, update, deactivate police stations (location, jurisdiction, contact, officer count, active status)
    - Create, update, deactivate hospitals (location, emergency contact, capacity, services, operating status)
    - Create, update, deactivate relief centers (location, type, capacity)
    - Validate geographic coordinates (lat: −90 to +90, lng: −180 to +180) before activation
    - _Requirements: 27.1, 27.2, 27.3, 27.4_

  - [x] 10.2 Implement disaster event management endpoints
    - CRUD for disaster events (name, region, severity, start/end date, status)
    - Associate SOS incidents with disaster events
    - Event-level analytics (SOS count, breakdown by type, dispatch/resolution counts, average times)
    - _Requirements: 28.1, 28.2, 28.3_

  - [x] 10.3 Write property test for facility coordinate validation
    - **Property 35: Facility Coordinate Validation**
    - Generate random coordinates and verify validation rejects out-of-range values
    - **Validates: Requirements 27.4**

- [x] 11. Checkpoint - Ensure all backend services complete and tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Survivor PWA - Offline engine and core SOS flow
  - [x] 12.1 Set up Dexie database schema and local repositories
    - Define IndexedDB schema for LocalSOSRecord, LocalProfile, LocalPushSubscription
    - Create repository layer with CRUD operations
    - Implement transactional writes with single retry on failure
    - _Requirements: 3.1, 3.5, 13.4_

  - [x] 12.2 Implement ConnectivityManager interface and WebConnectivityProvider
    - Implement getStatus() returning 'connected' | 'weak' | 'offline'
    - Implement health check with latency measurement (>5s = weak)
    - Implement subscribe() for connectivity change listeners
    - Implement sendSOS() and retryPendingSOS() with non-destructive error handling
    - Implement getDeliveryStatus() method
    - _Requirements: 4.1, 44.1, 44.2, 44.3, 44.4, 44.5_

  - [x] 12.3 Implement LocationService
    - getCurrentPosition() with configurable timeout (default 10s)
    - getLastKnownPosition() with max age check (30 minutes)
    - Handle permission denied gracefully
    - Return location metadata (accuracy, method, timestamp)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 12.4 Implement SOSCreator with one-tap creation flow
    - Generate UUID, capture GPS (with fallback), record timestamp
    - Save to IndexedDB BEFORE any network communication
    - Complete creation within 2 seconds
    - Detect duplicate taps within 30 seconds and prompt confirmation
    - Create SOS without requiring additional info, profile, or authentication
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 12.2, 13.2, 37.5_

  - [x] 12.5 Implement SyncEngine with exponential backoff
    - Queue SOS records and deliver in creation-time order (FIFO)
    - Process sequentially — failed record does not block subsequent records
    - Exponential backoff: min(5 × 2^n, 300) seconds
    - Mark as Failed after 10 consecutive failures
    - Resume on connectivity-change or app-focus events
    - Update status to Delivered on backend acknowledgement and remove from queue
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 12.6 Write property tests for SOS creation completeness
    - **Property 1: SOS Creation Completeness**
    - Generate random emergency type tap events with varying GPS states and verify all required fields present
    - **Validates: Requirements 1.2, 2.3, 3.1**

  - [x] 12.7 Write property test for local-first persistence invariant
    - **Property 2: Local-First Persistence Invariant**
    - Generate random SOS creations with varying connectivity and verify IndexedDB write occurs before network call
    - **Validates: Requirements 1.4, 3.3, 3.6**

  - [x] 12.8 Write property test for location age threshold
    - **Property 3: Location Age Threshold**
    - Generate random location ages and verify 30-minute threshold enforcement
    - **Validates: Requirements 2.2, 2.5**

  - [x] 12.9 Write property test for queue delivery order
    - **Property 5: Queue Delivery Order**
    - Generate random queues of SOS records with distinct timestamps and verify FIFO delivery
    - **Validates: Requirements 5.1**

  - [x] 12.10 Write property test for exponential backoff
    - **Property 6: Exponential Backoff (Sync)**
    - Generate random retry counts and verify backoff = min(5 × 2^n, 300) seconds
    - **Validates: Requirements 5.4**

  - [x] 12.11 Write property test for retry exhaustion
    - **Property 7: Retry Exhaustion**
    - Generate SOS records with varying retry counts and verify failure marking at 10 attempts
    - **Validates: Requirements 5.6**

  - [x] 12.12 Write property test for delivery confirmation transition
    - **Property 8: Delivery Confirmation Transition**
    - Generate SOS records receiving backend acknowledgement and verify status update and queue removal
    - **Validates: Requirements 5.5**

  - [x] 12.13 Write property test for ConnectivityManager status domain
    - **Property 17: ConnectivityManager Status Domain**
    - Generate random health check results and verify return value is exactly one of: connected, weak, offline
    - **Validates: Requirements 4.1, 44.2**

  - [x] 12.14 Write property test for non-destructive provider failure
    - **Property 18: Non-Destructive Provider Failure**
    - Generate random provider errors during sendSOS/retryPendingSOS and verify local SOS record remains unmodified
    - **Validates: Requirements 44.4**

  - [x] 12.15 Write property test for additional information independence
    - **Property 14: Additional Information Independence**
    - Generate random SOS creation attempts with/without optional fields and verify SOS creation never requires additional info
    - **Validates: Requirements 12.2, 13.2, 37.5**

- [x] 13. Checkpoint - Ensure Survivor PWA core SOS flow tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Survivor PWA - UI components and screens
  - [x] 14.1 Implement Home Screen with four emergency type buttons
    - Create four emergency buttons (Police/Rescue, Food/Water, Medical Help, Children/Elderly)
    - Minimum 48x48 CSS pixel touch targets
    - Color-coded with icons + text for accessibility
    - Haptic feedback on SOS creation (where supported)
    - _Requirements: 1.1, 16.1, 16.3, 16.6_

  - [x] 14.2 Implement connectivity status indicator component
    - Fixed position visible on every screen
    - Three states: Connected (green), Weak (amber), Offline (red)
    - Display using both text label, icon, AND color (color-independent)
    - Show "SOS WILL BE SAVED" when offline
    - Update within 5 seconds of state change
    - Default to Offline on launch until first check completes
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 14.3 Implement SOS delivery status display and confirmation UI
    - Show SOS identifier, emergency type, and delivery status on creation
    - Display appropriate status messages: "SOS saved. Waiting for connectivity.", "Sending...", "SOS received by the emergency network."
    - Never show "received" until backend confirms
    - Update displayed status within 3 seconds of transition
    - _Requirements: 1.6, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 14.4 Implement local SOS queue list view
    - Show all locally stored SOS records with ID, type, and status
    - Order by creation time (most recent first)
    - Update status within 3 seconds without manual refresh
    - Show "no emergency requests" message when empty
    - Function fully offline
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x] 14.5 Implement SOS history and timeline view
    - Display list of past SOS with ID, type, status, creation date
    - Chronological timeline of state transitions with timestamps (oldest to newest)
    - Load from IndexedDB when offline, from backend when online
    - _Requirements: 45.1, 45.2, 45.3, 10.5_

  - [x] 14.6 Implement optional additional information form
    - People count selector (1, 2, 3, 4, 5+)
    - Situation type selector (Trapped, Injured, Stranded, Threatened, Missing, Other)
    - Free-text description (max 200 characters)
    - Shown only after SOS creation, never required before
    - Support editing previously submitted info
    - Queue updates via offline-first sync mechanism
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

  - [x] 14.7 Implement optional user profile screen
    - Fields: name (max 100), language (English/Hindi), emergency contact (max 20), household size (1–99), accessibility preferences
    - Persist locally, available offline
    - Include populated profile fields with every SOS payload
    - Validate input constraints with inline error messages
    - Consent flow for emergency contact notifications
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 14.3_

  - [x] 14.8 Implement emergency offline mode UI
    - When offline: show only SOS creation, GPS status, local storage, history, retry status
    - Hide maps, analytics, animations, non-essential features entirely (not disabled)
    - Restore hidden features within 3 seconds of connectivity return
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 14.9 Write property test for delivery transparency
    - **Property 4: Delivery Transparency**
    - Generate random SOS records in various states and verify displayed status matches actual status and no false delivery messages shown
    - **Validates: Requirements 6.1, 6.2, 6.6**

  - [x] 14.10 Write property test for SOS list ordering
    - **Property 9: SOS List Ordering**
    - Generate random collections of SOS records and verify descending creation-time order
    - **Validates: Requirements 7.1**

  - [x] 14.11 Write property test for SOS lifecycle timeline ordering
    - **Property 13: SOS Lifecycle Timeline Ordering**
    - Generate random sets of state transition events and verify chronological ordering
    - **Validates: Requirements 10.5**

  - [x] 14.12 Write property test for profile inclusion with SOS
    - **Property 15: Profile Inclusion with SOS**
    - Generate random profile configurations and verify all populated fields are included in SOS payload
    - **Validates: Requirements 13.3**

  - [x] 14.13 Write property test for profile input validation
    - **Property 16: Profile Input Validation**
    - Generate random field values exceeding constraints and verify rejection with error messages
    - **Validates: Requirements 13.6**

- [x] 15. Survivor PWA - Service Worker and PWA configuration
  - [x] 15.1 Configure Service Worker with Workbox caching strategies
    - Cache-first for application shell (HTML, CSS, JS, icons, fonts)
    - Network-first for API requests with 5-second timeout
    - Cache-first with periodic update for static configuration
    - Register background sync for pending SOS delivery
    - Handle new version updates (download in background, activate on next launch)
    - Display "needs online first" message if cache empty and offline
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 46.1, 46.2, 46.3, 46.4_

  - [x] 15.2 Configure web app manifest and PWA installation
    - Manifest with app name, icons, theme color, standalone display mode, splash screen
    - App shortcuts: Request Rescue, Medical Help, Food/Water, My SOS
    - Support install prompts
    - _Requirements: 18.1, 18.2, 18.3_

  - [x] 15.3 Implement push notification registration and display
    - Request permission on first SOS creation
    - Register subscription with backend on approval
    - Display notifications with SOS ID and status message
    - Continue functioning without push if denied
    - _Requirements: 11.2, 11.3, 11.4_

- [x] 16. Survivor PWA - Accessibility, i18n, and low-battery mode
  - [x] 16.1 Implement multilingual support (English + Hindi)
    - Set up react-i18next with lazy-loaded translation bundles
    - Use translation keys for all user-facing text
    - Persist language preference locally
    - _Requirements: 15.1, 15.2, 15.3, 15.4_

  - [x] 16.2 Implement accessibility features
    - Semantic HTML with ARIA labels for all interactive elements
    - 48x48 CSS pixel minimum touch targets
    - High contrast mode support
    - Respect prefers-reduced-motion media query
    - Full keyboard navigation
    - Optional audio feedback mode
    - Color-independent status indicators
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.7_

  - [x] 16.3 Implement low-battery mode
    - Manual activation toggle
    - Disable animations, auto-refresh, video, heavy graphics, excessive location polling, unnecessary API requests
    - Maintain full SOS creation, storage, and delivery functionality
    - _Requirements: 17.1, 17.2, 17.3_

  - [x] 16.4 Write property test for low-battery mode core functionality
    - **Property 37: Low-Battery Mode Core Functionality**
    - Generate random SOS operations with low-battery mode active and verify core workflow completes without degradation
    - **Validates: Requirements 17.3**

- [x] 17. Checkpoint - Ensure Survivor PWA complete and tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 18. Responder PWA
  - [x] 18.1 Implement responder status management
    - Display current status with ability to set: Available, Busy, Assigned, En Route, On Scene, Offline
    - Immediately transmit status changes to backend
    - Record status change timestamps for audit
    - _Requirements: 19.1, 19.2, 19.3_

  - [x] 18.2 Implement incident alert handler with accept/decline
    - Display alert with: priority level, emergency type, distance, people count, location coordinates
    - Accept and Decline actions
    - 120-second timeout before treating as no-response
    - On accept: transition to En Route, display confirmation, notify backend
    - On decline: notify backend for reassignment
    - Queue response locally if offline, retry on connectivity
    - On timeout: dismiss alert, notify backend for escalation
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6_

  - [x] 18.3 Implement responder workflow lifecycle
    - Support workflow states: Available → Incident Received → Accept → En Route → Arrived → Assisted → Resolved
    - Transmit transitions to backend within 3 seconds
    - Log every transition with actor, timestamp, incident reference
    - _Requirements: 21.1, 21.2, 21.3_

  - [x] 18.4 Implement responder location updates
    - Transmit location (lat, lng, accuracy, timestamp) while app active and permission granted
    - Store updates with timestamp for freshness calculation
    - Function without location if permission denied
    - _Requirements: 22.1, 22.2, 22.3_

  - [x] 18.5 Write property test for responder status validity
    - **Property 29: Responder Status Validity**
    - Generate random status updates and verify value is one of the valid statuses
    - **Validates: Requirements 19.1**

  - [x] 18.6 Write property test for responder workflow state machine
    - **Property 30: Responder Workflow State Machine**
    - Generate random state transition sequences and verify only valid paths are accepted
    - **Validates: Requirements 21.1**

  - [x] 18.7 Write property test for incident alert content
    - **Property 39: Incident Alert Content**
    - Generate random incident alerts and verify all required fields (priority, type, distance, people count, coordinates) are present
    - **Validates: Requirements 20.1**

- [x] 19. Checkpoint - Ensure Responder PWA tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 20. Command Center - Live map and incident management
  - [x] 20.1 Implement Leaflet live map with incident, responder, and station markers
    - Color-code incidents by type (red Police, blue Medical, green Food, yellow Children/Elderly)
    - Show responder positions with type icons (police, ambulance, rescue)
    - Display stations (police, hospital, relief center)
    - Cluster geographically close incidents with count, zoom to individual on click
    - Update positions in real-time via WebSocket
    - _Requirements: 23.1, 23.2, 23.3, 23.4, 23.5_

  - [x] 20.2 Implement incident queue with filtering
    - Display queue with type, priority, region, time since creation, status
    - Filters: emergency type, priority, region (state/district/area), time range, status
    - Update filtered results within 2 seconds
    - _Requirements: 24.1, 24.2, 24.3_

  - [x] 20.3 Implement incident details panel
    - Display: SOS ID, type, location, accuracy, people count, description, creation time, waiting duration, priority band, region, status
    - Show full timeline of state transitions
    - Update in real-time as new events occur
    - _Requirements: 25.1, 25.2, 25.3_

  - [x] 20.4 Implement dispatch panel with responder ranking
    - Display ranked responders with distance, status, location freshness, suitability score
    - Flag stale locations (freshness > threshold)
    - Allow dispatcher to select and dispatch responder
    - Support human override (assign any available responder)
    - _Requirements: 26.1, 26.2, 26.3, 26.4, 32.3_

  - [x] 20.5 Write property test for SOS cluster aggregation
    - **Property 27: SOS Cluster Aggregation**
    - Generate random incident coordinates and verify clustering within proximity threshold
    - **Validates: Requirements 23.4**

  - [x] 20.6 Write property test for incident filter correctness
    - **Property 28: Incident Filter Correctness**
    - Generate random filter combinations and incident sets, verify all displayed match every filter and no matching incidents excluded
    - **Validates: Requirements 24.2**

- [x] 21. Command Center - Administration and monitoring
  - [x] 21.1 Implement station and facility management UI
    - CRUD forms for police stations, hospitals, relief centers
    - Coordinate validation (lat -90 to +90, lng -180 to +180)
    - Status management (active/inactive)
    - _Requirements: 27.1, 27.2, 27.3, 27.4_

  - [x] 21.2 Implement disaster event management UI
    - Create/edit disaster events with name, region, severity, dates, status
    - Associate SOS incidents with events
    - Display event analytics (totals, breakdowns, average times)
    - _Requirements: 28.1, 28.2, 28.3_

  - [x] 21.3 Implement response metrics dashboard
    - Calculate and display: acknowledgement time, dispatch time, travel time, resolution time, delivery time
    - _Requirements: 41.1, 41.2, 41.3, 41.4, 41.5_

  - [x] 21.4 Implement system health monitoring
    - Display health for: API server, Database, Notification service, WebSocket service, Sync service
    - Warning indicators for degraded/unavailable services
    - Update within 30 seconds of state change
    - _Requirements: 42.1, 42.2, 42.3_

  - [x] 21.5 Write property test for response metric accuracy
    - **Property 33: Response Metric Accuracy**
    - Generate random timestamp sets for incidents and verify metric calculations match definitions
    - **Validates: Requirements 41.1, 41.2, 41.3, 41.4, 41.5**

- [x] 22. Command Center - WebSocket connection management
  - [x] 22.1 Implement WebSocket connection with reconnection logic
    - Establish Socket.IO connection within 5 seconds of page load
    - Auto-reconnect with exponential backoff (1s base, 10 attempts max)
    - Show connection status indicator (connected/degraded/disconnected)
    - Manual reconnect button after exhausting retries
    - Request missed events on reconnection
    - _Requirements: 43.1, 43.4, 43.5, 43.6_

  - [x] 22.2 Write property test for WebSocket reconnection backoff
    - **Property 34: WebSocket Reconnection Backoff**
    - Generate random retry attempt numbers and verify backoff = 2^n seconds
    - **Validates: Requirements 43.4**

- [x] 23. Command Center - Audit trail viewer
  - [x] 23.1 Implement audit trail query interface
    - Filter by SOS ID, actor ID, event type, time range
    - Display results ordered by timestamp
    - Paginated results (max 100 per page)
    - Read-only view for Auditor role
    - _Requirements: 40.6, 36.1_

- [x] 24. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document using fast-check
- Unit tests validate specific examples and edge cases
- The design specifies TypeScript throughout — both frontend (React + Vite) and backend (Node.js + Express)
- Testing framework: Vitest + React Testing Library (frontend), Vitest (backend), fast-check (property-based)
- All 39 correctness properties from the design document are covered by property test tasks

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "1.4"] },
    { "id": 2, "tasks": ["2.1", "2.2", "2.3"] },
    { "id": 3, "tasks": ["2.4", "2.5", "4.1", "4.2"] },
    { "id": 4, "tasks": ["4.3", "4.4", "4.5", "5.1", "5.2"] },
    { "id": 5, "tasks": ["5.3", "5.4", "5.5", "5.6"] },
    { "id": 6, "tasks": ["5.7", "5.8", "5.9", "6.1", "6.2"] },
    { "id": 7, "tasks": ["6.3", "6.4", "8.1", "8.2", "8.3"] },
    { "id": 8, "tasks": ["8.4", "9.1", "9.2"] },
    { "id": 9, "tasks": ["9.3", "10.1", "10.2"] },
    { "id": 10, "tasks": ["10.3", "12.1", "12.2", "12.3"] },
    { "id": 11, "tasks": ["12.4", "12.5"] },
    { "id": 12, "tasks": ["12.6", "12.7", "12.8", "12.9", "12.10", "12.11", "12.12", "12.13", "12.14", "12.15"] },
    { "id": 13, "tasks": ["14.1", "14.2", "14.3", "14.4", "14.5", "14.6", "14.7", "14.8"] },
    { "id": 14, "tasks": ["14.9", "14.10", "14.11", "14.12", "14.13", "15.1", "15.2", "15.3"] },
    { "id": 15, "tasks": ["16.1", "16.2", "16.3"] },
    { "id": 16, "tasks": ["16.4", "18.1", "18.2", "18.3", "18.4"] },
    { "id": 17, "tasks": ["18.5", "18.6", "18.7"] },
    { "id": 18, "tasks": ["20.1", "20.2", "20.3", "20.4"] },
    { "id": 19, "tasks": ["20.5", "20.6", "21.1", "21.2", "21.3", "21.4"] },
    { "id": 20, "tasks": ["21.5", "22.1"] },
    { "id": 21, "tasks": ["22.2", "23.1"] }
  ]
}
```
