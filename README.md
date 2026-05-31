# 123... Poof — Co-Teaching Timer

**123... Poof** is a Chrome Extension that provides a draggable classroom timer overlay for virtual co-teachers, classroom support staff, and educators working across breakout rooms or small groups.

The extension can be used as a local timer or connected to a shared timer room so multiple educators can view and control the same countdown. This is especially helpful for virtual co-teachers who need a shared timer to know when to switch groups, wrap up an activity, or return to the main room.

## Inspiration

This project was inspired by my four years of virtual co-teaching and the everyday need for simple, shared classroom tools that support smooth instruction, transitions, and teamwork.

**123... Poof is dedicated to my partner teacher and dear friend, Dr. Felicia Lowman-Sikes**, whose care for students, families, and learning coaches continues to inspire the heart behind this project.

## Features

* Draggable timer overlay
* Local timer mode
* Shared Firebase-backed timer rooms
* Custom room names/codes
* Ability to join previously used rooms
* Ability to remove rooms from the recent room list
* Connection status display
* Custom preset timer buttons
* Custom minute/second timer input
* Start, pause, resume, and stop controls
* Compact timer view while running
* Saved panel position
* Maximum timer length of 24 hours
* Firebase Anonymous Authentication for shared room syncing

## How Shared Rooms Work

One educator creates a room name in the timer settings and shares that room code with a co-teacher or support staff member. The other educator enters the same code to connect to the room.

Once connected, both users can see and control the same countdown.

Room names should be generic and should not include student names or sensitive information.

## Privacy

123... Poof is designed to avoid collecting student or classroom content.

The extension may store limited timer-related data needed for functionality, including:

* Timer room codes and room display names
* Timer state, such as running, paused, stopped, selected duration, seconds left, and end time
* Custom preset timer settings
* Saved recent room choices
* Timer panel position
* Anonymous Firebase Authentication user ID

123... Poof does **not** collect or store:

* Student names
* Class rosters
* Learning coach information
* Meeting links
* Website content
* Screenshots
* Chat messages
* Browsing history
* Personal communications

## Tech Stack

* HTML
* CSS
* JavaScript
* Chrome Extension Manifest V3
* Firebase Realtime Database
* Firebase Anonymous Authentication

## Project Structure

```text
123-poof/
├── manifest.json
├── popup.html
├── popup.css
├── popup.js
├── content.js
├── content.css
├── firebase-config.js
├── firebase-app-compat.js
├── firebase-auth-compat.js
├── firebase-database-compat.js
└── icons/
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png
```

## Local Development Setup

1. Clone or download this repository.
2. Open Google Chrome.
3. Go to:

```text
chrome://extensions/
```

4. Turn on **Developer mode**.
5. Click **Load unpacked**.
6. Select the extension project folder.
7. Open a regular webpage.
8. Click the **123... Poof** extension icon to open the timer overlay.

Note: Chrome does not allow extensions to run on internal pages such as `chrome://extensions`, `chrome://settings`, or the Chrome Web Store.

## Firebase Setup

This project uses Firebase Realtime Database and Firebase Anonymous Authentication for shared timer rooms.

To use your own Firebase project:

1. Create a Firebase project.
2. Add a web app.
3. Enable **Realtime Database**.
4. Enable **Anonymous Authentication**.
5. Add your Firebase configuration to `firebase-config.js`.
6. Make sure your Firebase Realtime Database rules are not left in open test mode.

Example `firebase-config.js` structure:

```js
window.COTEACH_FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.firebasestorage.app",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

window.COTEACH_TIMER_ROOM_ID = "";
```

If `COTEACH_TIMER_ROOM_ID` is left blank, users can start in local timer mode and create or join rooms manually.

## Firebase Rules

A basic authenticated-user rule set may look like this:

```json
{
  "rules": {
    "rooms": {
      "$roomId": {
        ".read": "auth != null",
        ".write": "auth != null",

        "meta": {
          ".validate": "newData.hasChildren(['roomId', 'displayName', 'ownerUid', 'active', 'createdAt'])"
        },

        "timer": {
          ".validate": "newData.hasChildren(['isRunning', 'isPaused', 'secondsLeft', 'lastUpdated'])"
        }
      }
    }
  }
}
```

These rules require users to be authenticated before reading or writing room data. Current shared room access is based on room codes, so users should avoid including student names or sensitive information in room names.

## Chrome Web Store Notes

123... Poof does not use remote code. All JavaScript, including Firebase SDK files, is included locally in the extension package. Firebase is used as a remote data service for authentication and timer-room syncing only.

## Future Improvements

Planned or possible future features include:

* Stronger room membership controls
* Google sign-in option
* Room owner controls
* Optional room deletion
* User presence indicator
* More visual theme options
* Improved accessibility features
* Additional timer sound/notification options

## License

This project is currently shared for portfolio and educational purposes. Add a license before wider public reuse or contribution.
