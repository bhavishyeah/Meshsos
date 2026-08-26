

> **PWA Phase = full emergency-response platform with offline-first SOS, GPS, geo-aware dispatch, responder tracking, command center, notifications, audit trail, analytics, etc.**
>
> **Native mesh communication is NOT part of this phase.** It will be a future communication adapter that plugs into the same architecture.

And **MeshSOS is only a temporary working name. It is NOT the final product name.**

# 🚨 EMERGENCY SOS SYSTEM

## Full-Fledged PWA Product Blueprint

### Working Name

**MeshSOS — Temporary Codename**

### Final Name

**TBD**

### Product Category

**Emergency Communication, Incident Management & Intelligent Disaster Response**

### Core Promise

> **When someone needs help, the system should capture where they are, understand what they need, identify the right responder, and keep the emergency request alive until it reaches the rescue network.**

---

# 1. PRODUCT VISION

The platform connects three sides of an emergency:

```text
              SURVIVOR
                 │
                 │ SOS + Location
                 ▼
          EMERGENCY PLATFORM
                 │
       ┌─────────┴─────────┐
       │                   │
       ▼                   ▼
  DISPATCH ENGINE      COMMAND CENTER
       │                   │
       ▼                   ▼
 RESPONDER / TEAM     MONITORING
       │
       ▼
     RESCUE
```

The survivor doesn't need to know:

* Which police station is responsible
* Which hospital is nearest
* Which ambulance is available
* Which officer is patrolling
* Which team should be dispatched

The platform handles that complexity.

---

# 2. THE CORE USER JOURNEY

The most important flow is:

```text
OPEN PWA
   ↓
PRESS SOS
   ↓
CAPTURE LOCATION
   ↓
CREATE INCIDENT
   ↓
STORE LOCALLY
   ↓
ATTEMPT DELIVERY
   ↓
BACKEND RECEIVES SOS
   ↓
IDENTIFY REGION
   ↓
IDENTIFY EMERGENCY TYPE
   ↓
FIND AVAILABLE RESPONDERS
   ↓
CALCULATE BEST RESPONDER
   ↓
DISPATCH
   ↓
RESPONDER ACCEPTS
   ↓
RESPONDER TRAVELS
   ↓
ARRIVES
   ↓
RESCUE / ASSISTANCE
   ↓
INCIDENT RESOLVED
```

This is the **central product loop**.

---

# 3. THE THREE MAIN APPLICATIONS

The platform consists of three interfaces.

## A. Survivor PWA

For civilians.

## B. Responder PWA

For police, medical personnel, rescue teams and authorized field personnel.

## C. Command Center

For dispatchers, supervisors and administrators.

All three communicate with the same backend.

---

# 4. SURVIVOR PWA

The survivor interface should be radically simpler than the command center.

The philosophy:

> **A person in danger should never have to learn the application.**

---

# 5. SURVIVOR HOME SCREEN

The primary screen contains four huge emergency actions.

### 🔴 I NEED POLICE / RESCUE

For:

* Personal danger
* Trapped person
* Accident
* Fire
* Disaster
* Immediate rescue

### 🟢 FOOD / WATER

For:

* Stranded survivors
* Relief requirements
* Food shortage
* Drinking water

### 🔵 MEDICAL HELP

For:

* Injury
* Illness
* Medical emergency
* Ambulance requirement

### 🟡 CHILDREN / ELDERLY

For:

* Missing/surrounded children
* Elderly requiring assistance
* Vulnerable individuals

The exact labels can be refined during UI design.

---

# 6. CONNECTIVITY INDICATOR

The survivor should always know whether the SOS can currently reach the backend.

### Connected

> 🟢 **CONNECTED**

### Poor

> 🟠 **WEAK CONNECTION**

### Offline

> 🔴 **OFFLINE — SOS WILL BE SAVED**

This prevents confusion.

---

# 7. ONE-TAP SOS

When the survivor presses a button:

```text
BUTTON PRESS
      ↓
GENERATE SOS ID
      ↓
CAPTURE GPS
      ↓
CAPTURE TIMESTAMP
      ↓
CREATE INCIDENT
      ↓
SAVE LOCALLY
      ↓
TRY TO SEND
```

The SOS should be created **before** waiting for network communication.

---

# 8. GPS LOCATION

The PWA requests device location permission and attempts to obtain:

* Latitude
* Longitude
* Accuracy
* Timestamp

Example:

```text
Latitude: 30.3165
Longitude: 78.0322
Accuracy: 12m
```

The user doesn't need to know their coordinates.

The system handles it.

---

# 9. LOCATION FALLBACK

If the latest location cannot be acquired:

```text
CURRENT LOCATION
       ↓
LAST KNOWN LOCATION
       ↓
DISPLAY ACCURACY WARNING
```

Example:

> **Your current location could not be determined precisely. Your last available location will be shared.**

Never silently pretend inaccurate coordinates are precise.

---

# 10. OPTIONAL SOS INFORMATION

After the SOS is safely created, the system can optionally ask:

### How many people need help?

```text
1
2
3
4
5+
```

### Situation

* Trapped
* Injured
* Stranded
* Threatened
* Missing
* Other

### Optional description

A short message.

But **none of these should be mandatory**.

The emergency request must work with one tap.

---

# 11. SOS ID

Every incident receives a unique identifier.

Example:

```text
SOS-2026-08-24-A8F31C
```

Internally, use a proper UUID.

The ID remains unchanged throughout the entire incident lifecycle.

---

# 12. OFFLINE-FIRST ENGINE

This is one of the most important parts of the PWA.

The application must be able to create an SOS even when:

```text
Internet ❌
Wi-Fi Internet ❌
Mobile Data ❌
```

The PWA stores it locally.

---

# 13. LOCAL DATABASE

Use:

### IndexedDB

Potentially through a wrapper such as Dexie.

Store:

```text
SOS ID
Emergency type
Latitude
Longitude
Accuracy
Timestamp
People count
Description
Priority
Status
Retry count
Last transmission attempt
Created at
Updated at
```

---

# 14. LOCAL SOS QUEUE

Example:

```text
OFFLINE QUEUE

SOS-001   RESCUE       QUEUED
SOS-002   MEDICAL      RETRYING
SOS-003   FOOD         DELIVERED
SOS-004   RESCUE       QUEUED
```

The user can see:

> **Your SOS is safely stored on this device.**

---

# 15. AUTOMATIC SYNCHRONIZATION

When connectivity returns:

```text
OFFLINE
   ↓
CONNECTIVITY RETURNS
   ↓
SYNC ENGINE
   ↓
SEND QUEUED SOS
   ↓
SERVER ACKNOWLEDGEMENT
   ↓
MARK DELIVERED
```

Where browser support allows, Background Sync can assist with deferred delivery. The application should also retry when the app is reopened or regains focus because browser support for background capabilities varies.

---

# 16. SERVICE WORKER

The service worker handles the offline application shell.

Cache:

* HTML
* CSS
* JavaScript
* Icons
* Emergency interface
* Fonts
* Required static assets

Therefore:

```text
Internet OFF
       ↓
PWA still opens
       ↓
Emergency interface available
```

---

# 17. EMERGENCY OFFLINE MODE

When disconnected, unnecessary features disappear.

Keep:

* SOS
* GPS
* Local storage
* SOS history
* Retry status

Remove/deprioritize:

* Maps
* Analytics
* Large images
* Animations
* Non-essential API requests

---

# 18. SOS STATUS SYSTEM

Every SOS has a clear lifecycle.

```text
CREATED
   ↓
SAVED
   ↓
QUEUED
   ↓
SENDING
   ↓
DELIVERED
   ↓
ACKNOWLEDGED
   ↓
DISPATCHED
   ↓
EN ROUTE
   ↓
ARRIVED
   ↓
RESOLVED
```

Failure:

```text
SENDING
   ↓
FAILED
   ↓
QUEUED
   ↓
RETRY
```

---

# 19. CRITICAL COMMUNICATION RULE

The system must **never lie about delivery**.

If the backend hasn't received the SOS:

❌ "SOS received."

Instead:

> **SOS saved. Waiting for connectivity.**

Once the backend confirms:

> **SOS received by the emergency network.**

This is a fundamental trust principle.

---

# 20. SURVIVOR SOS HISTORY

The user can view:

### My Emergency Requests

```text
SOS #184
Medical
Delivered
Today — 14:32

SOS #163
Rescue
Resolved
Yesterday — 18:21
```

---

# 21. SOS TIMELINE

Every incident displays:

```text
14:32:01
SOS CREATED

14:32:02
LOCATION CAPTURED

14:32:05
SAVED LOCALLY

14:32:12
SERVER RECEIVED

14:33:01
OPERATOR ACKNOWLEDGED

14:34:20
TEAM DISPATCHED

15:02:40
TEAM ARRIVED

15:10:12
RESOLVED
```

---

# 22. SURVIVOR NOTIFICATIONS

When the incident changes state:

### Received

> Your SOS has reached the emergency network.

### Acknowledged

> Your request has been reviewed by the emergency control center.

### Dispatched

> A rescue team has been assigned.

### En Route

> Your rescue team is on the way.

### Arrived

> Rescue personnel have reached your location.

### Resolved

> Your emergency request has been marked resolved.

Push notifications can be used where supported and permitted.

---

# 23. MULTILINGUAL SUPPORT

Initial:

**English + Hindi**

Architecture should support expansion into major Indian languages.

Use translation keys rather than hardcoded text.

---

# 24. ACCESSIBILITY

Support:

* Large touch targets
* Screen readers
* High contrast
* Reduced motion
* Large text
* Icon + text
* Keyboard accessibility
* Vibration feedback where supported
* Color-independent status indicators

---

# 25. EMERGENCY AUDIO FEEDBACK

Optional audio:

> "Rescue request created."

Useful for:

* Visually impaired users
* Darkness
* Stressful conditions

It should be user-controlled because silence may sometimes be important.

---

# 26. LOW-BATTERY EXPERIENCE

The PWA cannot directly control all hardware power behavior, but it can reduce its own resource consumption.

Emergency mode should disable:

* Animations
* Auto-refresh
* Video
* Heavy graphics
* Excessive location polling
* Unnecessary API requests

---

# 27. OPTIONAL USER PROFILE

A survivor may optionally configure:

* Name
* Preferred language
* Emergency contact
* Household size
* Accessibility requirements

Do **not** make a profile mandatory for creating an SOS.

---

# 28. EMERGENCY CONTACT

Optional feature.

When enabled, the system can notify a designated emergency contact when an SOS reaches the backend.

Example:

> **Emergency request created by [Name].**

This should comply with applicable privacy and consent requirements.

---

# 29. GEO-AWARE EMERGENCY DISPATCH

This is the major feature we added after your ABC example.

The system doesn't simply send:

> SOS → Police Station A

Instead:

> **SOS → Location → Region → Emergency Type → Available Responders → Best Responder**

---

# 30. SERVICE AREA MODEL

The platform contains geographic regions.

Example:

```text
AREA ABC
│
├── Police Station A
├── Police Station B
├── Police Station C
├── Hospital A
├── Hospital B
├── Ambulance Teams
└── Rescue Teams
```

Each region has its own:

* Responders
* Stations
* Hospitals
* Ambulances
* Dispatch rules
* Jurisdiction

---

# 31. REGION DETECTION

When an SOS arrives:

```text
GPS
 ↓
Geographic boundary lookup
 ↓
Region ABC
```

The backend determines:

> **Which emergency service region contains this location?**

This allows the system to route the incident correctly.

---

# 32. EMERGENCY-TYPE ROUTING

Different SOS types can trigger different responder pools.

### Police / Rescue

→ Police officers
→ Rescue teams
→ Disaster response teams

### Medical

→ Ambulance
→ Medical responders
→ Appropriate hospital

### Food / Water

→ Relief teams
→ Local administration
→ Relief distribution center

### Children / Elderly

→ Appropriate rescue/social-response team
→ Police where necessary
→ Medical services when required

---

# 33. RESPONDER DATABASE

Every authorized responder can have:

```text
Responder ID
Name
Role
Organization
Station
Current location
Location timestamp
Availability
Current assignment
Vehicle
Capabilities
```

---

# 34. POLICE STATION MODEL

Example:

```text
POLICE STATION ABC-02

Jurisdiction:
ABC Sector 2

Location:
30.3165, 78.0322

Officers:
18

Available:
7

On Patrol:
4

Busy:
7
```

---

# 35. INDIVIDUAL PATROL LOCATION

This is where your original idea becomes powerful.

Suppose:

```text
Police Station A → 8 km
Police Station B → 5 km
Police Station C → 7 km
```

But:

```text
Officer 17
1.2 km from survivor
AVAILABLE
```

The system should prioritize **Officer 17**, not automatically select the nearest station.

---

# 36. RESPONDER LOCATION FRESHNESS

Never blindly trust an old location.

Example:

```text
Officer 17

Distance: 1.2 km
Status: AVAILABLE
Last update: 8 seconds ago
```

Good.

But:

```text
Officer 21

Distance: 0.8 km
Status: AVAILABLE
Last update: 43 minutes ago
```

This location is potentially stale.

The dispatch engine should consider location freshness.

---

# 37. RESPONDER AVAILABILITY

Each responder can have:

```text
AVAILABLE
BUSY
ASSIGNED
EN ROUTE
ON SCENE
OFFLINE
```

The dispatch engine should generally avoid assigning:

**BUSY / OFFLINE** responders.

---

# 38. GEO-DISPATCH ENGINE

The engine evaluates:

* Distance
* Availability
* Emergency type
* Jurisdiction
* Current assignment
* Responder capability
* Location freshness
* Vehicle availability
* Priority

Conceptually:

```text
SOS
 ↓
Find region
 ↓
Find suitable responders
 ↓
Remove unavailable responders
 ↓
Remove stale/unreliable locations
 ↓
Calculate distance
 ↓
Evaluate suitability
 ↓
Rank responders
 ↓
Dispatch highest-ranked candidate
```

---

# 39. RESPONDER RANKING

Example:

| Responder | Distance | Status    | Freshness | Suitability |
| --------- | -------: | --------- | --------- | ----------- |
| Officer A |   1.2 km | Available | 8 sec     | ⭐⭐⭐⭐⭐       |
| Officer B |   0.8 km | Busy      | 5 sec     | ❌           |
| Officer C |   2.1 km | Available | 12 sec    | ⭐⭐⭐⭐        |
| Station B |   4.3 km | Available | Static    | ⭐⭐⭐         |

The system recommends:

> **Officer A**

---

# 40. DISPATCH ESCALATION

If the first responder doesn't acknowledge:

```text
SOS
 ↓
Responder A
 ↓
No response
 ↓
Responder B
 ↓
No response
 ↓
Station dispatcher
 ↓
Supervisor escalation
```

Timeouts should be configurable based on emergency priority.

---

# 41. HUMAN OVERRIDE

Automation should **recommend**, not blindly control life-critical decisions.

An authorized dispatcher can override:

> **Assign different responder**

This is essential.

---

# 42. RESPONDER PWA

Responders have their own interface.

### Home

```text
STATUS

🟢 AVAILABLE

Active Assignment: None
```

---

# 43. RESPONDER INCIDENT ALERT

Example:

> 🔴 **NEW CRITICAL INCIDENT**

```text
Medical emergency
1.4 km away

4 people

30.3165, 78.0322
```

Actions:

**ACCEPT**

**DECLINE**

---

# 44. RESPONDER WORKFLOW

```text
AVAILABLE
   ↓
INCIDENT RECEIVED
   ↓
ACCEPT
   ↓
EN ROUTE
   ↓
ARRIVED
   ↓
ASSISTED
   ↓
RESOLVED
```

Every transition is logged.

---

# 45. RESPONDER LOCATION

The responder PWA can provide location updates while the responder is actively using/operating it, subject to browser permissions and platform limitations.

The system records:

```text
Latitude
Longitude
Timestamp
Accuracy
```

This allows dispatchers to see responder positions.

---

# 46. COMMAND CENTER

The command center is the central operational interface.

It includes:

### Live Map

### Incident Queue

### Responder Map

### Dispatch Panel

### Analytics

### Audit Trail

### System Health

---

# 47. COMMAND DASHBOARD

Example:

```text
EMERGENCY COMMAND CENTER

ACTIVE SOS              428
CRITICAL                 63
MEDICAL                 117
RESCUE                  182
FOOD / WATER             66

DISPATCHED              247
RESOLVED                 91
```

---

# 48. LIVE MAP

The map displays:

### Survivor incidents

🔴 Rescue
🔵 Medical
🟢 Food/Water
🟡 Vulnerable

### Responders

🚔 Police
🚑 Ambulance
🛟 Rescue team

### Stations

🏢 Police
🏥 Hospital
📍 Relief center

---

# 49. SOS CLUSTERING

If dozens of SOS requests occur in the same area:

```text
        🔴
    🔴 🔴 🔴
  🔴 🔴 🔴 🔴

       27
     SOS REQUESTS
```

Instead of flooding the map with markers.

Clicking the cluster zooms into the individual incidents.

---

# 50. INCIDENT FILTERS

Operators can filter by:

### Emergency type

* Police
* Medical
* Food
* Vulnerable

### Priority

* Critical
* High
* Medium
* Low

### Region

* State
* District
* Area

### Time

* Last 15 minutes
* Last hour
* Today
* Custom

### Status

* New
* Acknowledged
* Dispatched
* En Route
* Resolved

---

# 51. INCIDENT DETAILS PANEL

Example:

```text
SOS #184

TYPE
Medical

LOCATION
30.3165, 78.0322

ACCURACY
14m

PEOPLE
4

CREATED
14:32

WAITING
21 minutes

PRIORITY
CRITICAL

REGION
ABC

STATUS
DISPATCHED
```

---

# 52. DISPATCH PANEL

Shows:

```text
AVAILABLE RESPONDERS

Officer A
1.2 km
Available
Updated 8 sec ago

Officer C
2.1 km
Available
Updated 12 sec ago

Ambulance 04
2.8 km
Available
Updated 5 sec ago
```

Operator selects:

**DISPATCH**

---

# 53. HOSPITAL MANAGEMENT

Hospitals can be registered in the system.

Store:

* Location
* Emergency contact
* Capacity information
* Available services
* Operating status

For medical incidents, the system can identify suitable hospitals.

Actual hospital/ambulance integration would require authorized institutional APIs and agreements; the PWA itself shouldn't pretend that it can automatically dispatch a real ambulance without such infrastructure.

---

# 54. POLICE STATION MANAGEMENT

Admin can configure:

* Station location
* Jurisdiction
* Contact
* Officers
* Shift information
* Active status

---

# 55. RELIEF CENTER MANAGEMENT

For food/water emergencies:

```text
Relief Center A
2.4 km

Water Distribution Point B
3.1 km

Relief Camp C
4.8 km
```

The system can route supply requests appropriately.

---

# 56. PRIORITY ENGINE

Suggested priority can consider:

* Medical emergency
* Children/elderly
* Number of people
* Time waiting
* Location risk
* Multiple SOS cluster
* Disaster severity

Example:

```text
Medical                +40
Vulnerable people      +25
5+ people              +20
Long waiting time      +15
High-risk zone         +20
```

Then:

```text
81–100  CRITICAL
61–80   HIGH
31–60   MEDIUM
0–30    LOW
```

This is a **recommendation system**, not autonomous life-or-death decision making.

---

# 57. DISASTER EVENT MANAGEMENT

Administrators can create:

> **2026 Uttarakhand Flood Response**

with:

* Event name
* Geographic region
* Severity
* Start date
* End date
* Status

All SOS incidents during the event can be associated with it.

---

# 58. EVENT ANALYTICS

Example:

```text
UTTARAKHAND FLOOD RESPONSE

Total SOS:       1,284
Critical:          187
Medical:           342
Rescue:            421
Food/Water:        491

Dispatched:        706
Resolved:          214

Avg acknowledgement: 4m 12s
Avg dispatch:         8m 41s
Avg arrival:         22m 18s
```

---

# 59. AUDIT TRAIL

Every incident gets a permanent history.

Example:

```text
14:32:01
SOS CREATED

14:32:02
GPS ACQUIRED

14:32:09
SERVER RECEIVED

14:32:15
INCIDENT CREATED

14:33:10
OPERATOR ACKNOWLEDGED

14:34:01
RESPONDER ASSIGNED

14:35:20
DISPATCHED

14:51:33
RESPONDER ARRIVED

15:02:12
INCIDENT RESOLVED
```

No silent status changes.

---

# 60. RESPONSE METRICS

Measure:

### Acknowledgement time

SOS → operator acknowledgement

### Dispatch time

SOS → responder assignment

### Travel time

Dispatch → arrival

### Resolution time

Creation → resolution

### Delivery time

SOS creation → server reception

---

# 61. SYSTEM HEALTH

Command center should show:

```text
API               🟢
DATABASE          🟢
NOTIFICATIONS     🟢
REALTIME          🟢
SYNC SERVICE      🟢
```

If something fails:

```text
⚠ Notification service degraded
```

---

# 62. ROLE SYSTEM

### Survivor

Create and track own SOS.

### Responder

Receive assigned incidents.

### Dispatcher

Manage incidents and dispatch.

### Supervisor

Monitor teams and operations.

### Administrator

Manage entire system.

### Auditor

Read-only historical access.

---

# 63. AUTHENTICATION

Administrative/responder interfaces should require authentication.

Implement:

* Secure sessions
* Strong authentication
* MFA for privileged roles
* Session expiry
* Role-based authorization
* Device/session management

Survivors should have a **low-friction emergency experience**.

---

# 64. SECURITY

Implement:

* HTTPS
* Secure API
* Input validation
* Authorization
* Rate limiting
* Secure headers
* XSS protection
* CSRF protection where applicable
* Secure cookies/session handling
* Audit logs
* Database protection
* Minimal personal information

---

# 65. FALSE SOS PROTECTION

Potential mechanisms:

### Rate limiting

Prevent repeated abuse.

### Duplicate detection

Detect repeated incident submissions.

### Suspicious behavior flags

Flag abnormal activity.

### Human verification

Dispatch remains under authorized human control.

---

# 66. SOS DEDUPLICATION

If the same person accidentally presses the SOS several times:

```text
SOS #101
SOS #102
SOS #103
```

the backend can identify potential duplicates using:

* Device/session
* Location proximity
* Timestamp
* Emergency category

and suggest:

> **Possible duplicate incident**

---

# 67. PWA INSTALLATION

The PWA should provide:

* Manifest
* Icons
* Standalone display
* App name
* Theme
* Splash configuration where supported
* Install prompt
* Home-screen shortcut

The emergency app should feel like an application, not merely a website.

---

# 68. PWA SHORTCUTS

Where supported:

### Emergency App

* Request Rescue
* Medical Help
* Food / Water
* My SOS

---

# 69. OFFLINE CACHE STRATEGY

### Emergency shell

**Cache-first**

### Emergency UI assets

**Cache-first**

### API requests

**Network-first**

### Live dashboard

**Network-first**

### Static configuration

**Cache-first + periodic update**

---

# 70. CONNECTIVITY MANAGER

Create a dedicated abstraction:

```text
ConnectivityManager

getStatus()

sendSOS()

retryPendingSOS()

getDeliveryStatus()
```

Current PWA implementation:

```text
WebConnectivityProvider
```

Future:

```text
NativeMeshProvider
```

This is crucial because **future mesh communication can be added without rewriting the entire application.**

---

# 71. CURRENT PWA COMMUNICATION MODEL

For this phase:

```text
             SOS
              │
       ┌──────┴──────┐
       │             │
    ONLINE        OFFLINE
       │             │
       ▼             ▼
   Backend       IndexedDB
       │             │
       │       Connectivity
       │          returns
       │             │
       └───────◄─────┘
               │
               ▼
            Backend
```

---

# 72. WHAT THE PWA DOES NOT CLAIM

The PWA-only version does **not** claim:

❌ Phone-to-phone Bluetooth mesh
❌ Offline SOS transmission to nearby police phones
❌ Wi-Fi Direct mesh
❌ Persistent background BLE relay
❌ Direct communication without any available communication path

Those require a future native communication layer.

---

# 73. WHAT THE PWA DOES GUARANTEE

The system can aim to guarantee:

### **SOS preservation**

Once successfully created, the SOS is stored locally.

### **Delivery transparency**

The system clearly indicates whether it has reached the server.

### **Automatic retry**

The system attempts delivery whenever supported connectivity returns.

### **Geo-aware dispatch**

Once the backend receives the SOS, it can identify the appropriate region and responder.

---

# 74. ABC EXAMPLE — FINAL FLOW

Now let's apply everything to your exact scenario.

### Area ABC

```text
Police Station A
Police Station B
Police Station C

Hospital A
Hospital B
```

User is somewhere inside ABC.

They don't know their exact location.

They press:

### 🔴 I NEED POLICE / RESCUE

The PWA:

```text
Captures GPS
     ↓
30.3165, 78.0322
     ↓
Creates SOS
     ↓
Sends to backend
```

Backend:

```text
GPS
 ↓
ABC region detected
 ↓
Emergency type = Police
 ↓
Find available police responders
 ↓
Check their latest locations
 ↓
Calculate distance
 ↓
Check availability
 ↓
Check jurisdiction
 ↓
Rank candidates
```

Suppose:

```text
Station A       7.8 km
Station B       4.2 km
Station C       6.1 km

Officer 17      1.2 km
Officer 17      AVAILABLE
Last update     8 seconds ago
```

The system recommends:

> **Officer 17 — 1.2 km away**

Officer receives:

> 🔴 **CRITICAL SOS — 1.2 km away**

Officer:

**ACCEPT**

Then:

```text
SOS
 ↓
Officer Assigned
 ↓
Officer En Route
 ↓
Officer Arrived
 ↓
Rescue
 ↓
Resolved
```

Meanwhile the survivor sees:

> **Rescue team dispatched.**

That is the **actual product experience** we're designing.

---

# 75. WHAT IF THE USER IS OFFLINE?

Suppose:

```text
GPS: ✅
Internet: ❌
```

The PWA:

```text
Creates SOS
 ↓
Stores SOS
 ↓
Shows:
"Your SOS is safely stored."
```

When connectivity returns:

```text
SOS uploaded
 ↓
ABC region detected
 ↓
Geo-dispatch
 ↓
Nearest suitable responder
```

### What does NOT happen in this PWA-only phase?

The survivor's phone cannot independently transmit the SOS to a nearby police officer merely because that officer is physically nearby.

That requires the future native communication layer.

---

# 76. TECH STACK

### Frontend

**React + TypeScript**

### UI

**Tailwind CSS**

### PWA

**Vite + PWA plugin / Workbox**

### Local database

**IndexedDB + Dexie**

### Backend

**Node.js + Express**

### Database

**PostgreSQL**

### Real-time

**WebSockets / Socket.IO**

### Maps

**Leaflet**

### Geospatial calculations

Backend geospatial logic / PostgreSQL geospatial capabilities as the system grows.

### Notifications

**Web Push**

### Authentication

Secure session/token architecture.

---

# 77. FRONTEND STRUCTURE

```text
src/
│
├── app/
│   ├── router/
│   ├── providers/
│   └── config/
│
├── features/
│   ├── emergency/
│   ├── sos/
│   ├── location/
│   ├── offline/
│   ├── sync/
│   ├── notifications/
│   ├── profile/
│   ├── incidents/
│   ├── dispatch/
│   ├── responders/
│   ├── command-center/
│   ├── analytics/
│   └── admin/
│
├── components/
│   ├── ui/
│   ├── maps/
│   ├── emergency/
│   ├── incidents/
│   └── responders/
│
├── services/
│   ├── api/
│   ├── location/
│   ├── storage/
│   ├── sync/
│   └── notifications/
│
├── db/
│   ├── schema/
│   └── repositories/
│
├── workers/
│   └── service-worker/
│
├── hooks/
├── types/
├── utils/
└── i18n/
```

---

# 78. BACKEND ARCHITECTURE

```text
                 API SERVER
                     │
        ┌────────────┼─────────────┐
        ▼            ▼             ▼
    SOS Service  Dispatch      Auth Service
                     │
                     ▼
              Geo Engine
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
     Police       Medical       Rescue
        │            │            │
        └────────────┼────────────┘
                     ▼
                PostgreSQL
                     │
       ┌─────────────┼─────────────┐
       ▼             ▼             ▼
 Notifications    WebSockets    Analytics
```

---

# 79. CORE DATABASE ENTITIES

### Users

```text
id
role
name
contact
language
created_at
```

### SOS

```text
id
user_id
type
latitude
longitude
accuracy
people_count
description
priority
status
region_id
created_at
updated_at
```

### SOS Events

```text
id
sos_id
event_type
actor_id
timestamp
metadata
```

### Responders

```text
id
user_id
organization
station_id
current_latitude
current_longitude
location_updated_at
status
current_incident_id
```

### Stations

```text
id
name
type
latitude
longitude
region_id
status
```

### Teams

```text
id
name
type
region_id
status
```

### Regions

```text
id
name
boundary
status
```

### Hospitals

```text
id
name
location
services
capacity
status
```

### Disaster Events

```text
id
name
region_id
severity
status
start_at
end_at
```

---

# 80. TESTING REQUIREMENTS

## Offline tests

* Internet disappears during SOS
* Browser closes after SOS creation
* Device restarts
* Multiple queued SOS
* Connection returns
* Upload fails halfway
* Duplicate submission

## Location tests

* GPS unavailable
* Low accuracy
* Location changes
* Stale location
* Permission denied

## Dispatch tests

* Nearest responder busy
* Nearest responder offline
* Stale responder location
* Responder declines
* Responder doesn't acknowledge
* Multiple responders available

## Security tests

* Unauthorized dashboard
* Role escalation
* Fake SOS payload
* API abuse
* Session attacks

---

# 81. CORE PRODUCT PRINCIPLES

### Principle 1 — Never lose a successfully created SOS.

### Principle 2 — Never falsely claim delivery.

### Principle 3 — Never make the survivor understand the emergency infrastructure.

### Principle 4 — Prefer the nearest **suitable available responder**, not simply the nearest station.

### Principle 5 — Human operators retain control over critical dispatch decisions.

### Principle 6 — Offline capability must be designed into the architecture, not added later.

### Principle 7 — Collect the minimum personal data necessary.

### Principle 8 — Every important action should be auditable.

---

# 82. FINAL PRODUCT ARCHITECTURE

```text
                         ┌─────────────────────┐
                         │     SURVIVOR PWA    │
                         │                     │
                         │ SOS • GPS • Offline │
                         │ Queue • Status      │
                         └──────────┬──────────┘
                                    │
                                    ▼
                           ┌─────────────────┐
                           │   SYNC ENGINE   │
                           └────────┬────────┘
                                    │
                         ┌──────────┴──────────┐
                         │                     │
                     INTERNET              OFFLINE
                         │                     │
                         ▼                     ▼
                  ┌─────────────┐        IndexedDB
                  │  BACKEND API │             │
                  └──────┬──────┘             │
                         │             Connectivity
                         │                returns
                         │                     │
                         └──────────◄──────────┘
                                    │
                                    ▼
                          ┌──────────────────┐
                          │ SOS PROCESSOR    │
                          └────────┬─────────┘
                                   │
                                   ▼
                          ┌──────────────────┐
                          │ REGION DETECTOR  │
                          └────────┬─────────┘
                                   │
                                   ▼
                         ┌────────────────────┐
                         │ GEO-DISPATCH ENGINE│
                         └─────────┬──────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
          POLICE               MEDICAL               RESCUE
              │                    │                    │
              └────────────────────┼────────────────────┘
                                   ▼
                          ┌──────────────────┐
                          │ RESPONDER PWA   │
                          └────────┬─────────┘
                                   │
                                   ▼
                              RESOLUTION

                                   │
                                   ▼
                         ┌──────────────────┐
                         │ COMMAND CENTER   │
                         │                  │
                         │ Map              │
                         │ Incidents        │
                         │ Dispatch         │
                         │ Teams            │
                         │ Analytics        │
                         │ Audit Trail      │
                         └──────────────────┘
```

---

# 83. FUTURE — NOT PART OF THIS PWA

Once this PWA is mature, **then** we can introduce:

```text
          PWA
           │
           ▼
   COMMUNICATION ADAPTER
           │
     ┌─────┴─────┐
     ▼           ▼
 Internet    Native Mesh
             BLE / P2P
```

At that point:

```text
SURVIVOR
   │
   │ No Internet
   ▼
NEARBY PHONE
   │
   ▼
PATROL OFFICER
   │
   ▼
INTERNET
   │
   ▼
BACKEND
   │
   ▼
GEO-DISPATCH
```

But **we are not building that now**.

---

# 🏁 THE FINAL DEFINITION

So the PWA version of this project is **not merely an SOS button**.

It is a:

> **Full-fledged, offline-first emergency incident and intelligent dispatch platform that captures a survivor's location, creates and preserves emergency requests, automatically routes incidents according to geography and emergency type, identifies suitable available responders, manages dispatch and escalation, tracks the complete rescue lifecycle, and provides authorities with a real-time command center.**


