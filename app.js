import { io } from 'socket.io-client';
import './styles.css';

// Initialize Lucide Icons
lucide.createIcons();

// State Management
const state = {
  currentView: 'home',
  isBroadcasting: false,
  unitId: 'Unit ' + Math.floor(Math.random() * 9000 + 1000),
  gpsData: {
    lat: null,
    lng: null,
    spd: null,
    acc: null,
    heading: 0
  },
  watchId: null,
  map: null,
  markers: {},
  
  // P2P State
  peer: null,
  peerId: null,
  connections: {}, // peerId -> DataConnection
  remoteNodes: {}, // peerId -> { lat, lng, spd, heading, distance, lastUpdate }
  
  // Geofence State
  geofence: {
    active: false,
    lat: null,
    lng: null,
    radius: 500,
    circleLayer: null
  }
};

// Set initial unit ID in UI
document.getElementById('unit-name').value = state.unitId;

// DOM Elements
const views = {
  home: document.getElementById('view-home'),
  uplink: document.getElementById('view-uplink'),
  mesh: document.getElementById('view-mesh')
};

const navBtns = {
  home: document.getElementById('nav-home'),
  mesh: document.getElementById('nav-mesh')
};

const btns = {
  initDemo: document.getElementById('btn-init-demo'),
  viewSpecs: document.getElementById('btn-view-specs'),
  enableGps: document.getElementById('btn-enable-gps'),
  startBroadcast: document.getElementById('btn-start-broadcast'),
  connectPeer: document.getElementById('btn-connect-peer'),
  setGeofence: document.getElementById('btn-set-geofence'),
  clearGeofence: document.getElementById('btn-clear-geofence')
};

const ui = {
  gpsStatusText: document.getElementById('gps-status-text'),
  gpsDataContainer: document.getElementById('gps-data'),
  valLat: document.getElementById('val-lat'),
  valLng: document.getElementById('val-lng'),
  valSpd: document.getElementById('val-spd'),
  valAcc: document.getElementById('val-acc'),
  unitNameInput: document.getElementById('unit-name'),
  rosterList: document.getElementById('roster-list'),
  collisionAlerts: document.getElementById('collision-alerts'),
  peerIdDisplay: document.getElementById('peer-id-display'),
  targetPeerId: document.getElementById('target-peer-id'),
  geofenceAlerts: document.getElementById('geofence-alerts'),
  geofenceRadius: document.getElementById('geofence-radius'),
  geofenceStatusVal: document.getElementById('geofence-status-val')
};

// --- Initialization ---
function initPeer() {
  state.peer = io();
  
  state.peer.on('connect', () => {
    state.peerId = state.peer.id;
    ui.peerIdDisplay.textContent = `Room Active: v2x-global`;
    ui.peerIdDisplay.style.color = 'var(--safe)';
    ui.peerIdDisplay.style.cursor = 'default';
    ui.peerIdDisplay.title = "Connected to Node.js Broadcast Server";
  });
  
  state.peer.on('telemetry', (data) => {
    const peerId = data.peerId;
    const payload = data.payload;
    state.remoteNodes[peerId] = {
      ...payload,
      distance: calculateDistance(state.gpsData.lat, state.gpsData.lng, payload.lat, payload.lng),
      lastUpdate: Date.now()
    };
    updateRemoteMarker(peerId, payload);
    runCollisionEngine();
    updateRoster();
  });

  state.peer.on('peer_disconnected', (peerId) => {
    delete state.remoteNodes[peerId];
    if (state.markers[peerId]) {
      state.map.removeLayer(state.markers[peerId]);
      delete state.markers[peerId];
    }
    updateRoster();
  });
}

btns.connectPeer.addEventListener('click', () => {
  alert("Multi-device mode is active. You are automatically connected to the global room.");
});

// Initialize Socket.io on load
initPeer();


// --- Navigation Logic ---
function switchView(viewName) {
  state.currentView = viewName;
  
  Object.values(views).forEach(v => v.classList.remove('active'));
  views[viewName].classList.add('active');

  if (viewName === 'home') {
    navBtns.home.classList.add('active');
    navBtns.mesh.classList.remove('active');
  } else if (viewName === 'mesh') {
    navBtns.home.classList.remove('active');
    navBtns.mesh.classList.add('active');
    setTimeout(initMap, 100);
  } else {
    navBtns.home.classList.remove('active');
    navBtns.mesh.classList.remove('active');
  }
}

navBtns.home.addEventListener('click', () => switchView('home'));
navBtns.mesh.addEventListener('click', () => switchView('mesh'));
btns.initDemo.addEventListener('click', () => switchView('uplink'));
btns.viewSpecs.addEventListener('click', () => {
  document.getElementById('specs-section').scrollIntoView({ behavior: 'smooth' });
});


// --- Geolocation Logic ---
let lastLat = null;
let lastLng = null;
let lastTime = null;

btns.enableGps.addEventListener('click', async () => {
  if (!navigator.geolocation) {
    alert("Geolocation is not supported by your browser.");
    return;
  }

  ui.gpsStatusText.textContent = "ACQUIRING SIGNAL...";
  ui.gpsStatusText.classList.remove('online');
  btns.enableGps.disabled = true;
  btns.enableGps.textContent = "LOCATING...";

  state.watchId = navigator.geolocation.watchPosition(
    (position) => {
      ui.gpsStatusText.textContent = "LINK_ONLINE";
      ui.gpsStatusText.classList.add('online');
      ui.gpsDataContainer.classList.remove('hidden');
      btns.enableGps.textContent = "UPLINK ESTABLISHED";
      btns.enableGps.classList.remove('btn-primary');
      btns.enableGps.classList.add('btn-outline');

      // Calculate pseudo-heading if none provided by hardware
      let heading = position.coords.heading;
      if (heading === null && lastLat !== null && lastLng !== null) {
        heading = calculateHeading(lastLat, lastLng, position.coords.latitude, position.coords.longitude);
      }

      state.gpsData.lat = position.coords.latitude;
      state.gpsData.lng = position.coords.longitude;
      state.gpsData.spd = position.coords.speed || 0; 
      state.gpsData.acc = position.coords.accuracy || 0; 
      state.gpsData.heading = heading || 0;

      lastLat = state.gpsData.lat;
      lastLng = state.gpsData.lng;
      lastTime = Date.now();

      ui.valLat.textContent = state.gpsData.lat.toFixed(6);
      ui.valLng.textContent = state.gpsData.lng.toFixed(6);
      ui.valSpd.textContent = state.gpsData.spd.toFixed(2) + ' m/s';
      ui.valAcc.textContent = state.gpsData.acc.toFixed(1) + ' m';

      updateMyMapPosition();
      checkGeofence();

      if (state.currentView !== 'mesh' && !state.isBroadcasting) {
        setTimeout(() => switchView('mesh'), 1500);
      }
    },
    (error) => {
      ui.gpsStatusText.textContent = "ERROR: " + error.message;
      btns.enableGps.disabled = false;
      btns.enableGps.textContent = "RETRY UPLINK";
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
  );
});


// --- Live Mesh Logic ---
let broadcastInterval;

btns.startBroadcast.addEventListener('click', () => {
  state.unitId = ui.unitNameInput.value || 'Unit 9766';
  
  if (!state.isBroadcasting) {
    if (state.gpsData.lat === null) {
      alert("No GPS fix. Please enable sensor uplink first.");
      switchView('uplink');
      return;
    }
    
    state.isBroadcasting = true;
    btns.startBroadcast.textContent = "STOP BROADCAST";
    btns.startBroadcast.classList.remove('btn-primary');
    btns.startBroadcast.classList.add('btn-outline');
    
    updateRoster();
    
    // Broadcast loop (10Hz)
    broadcastInterval = setInterval(() => {
      const payload = {
        type: 'telemetry',
        payload: {
          unitId: state.unitId,
          lat: state.gpsData.lat,
          lng: state.gpsData.lng,
          spd: state.gpsData.spd,
          heading: state.gpsData.heading
        }
      };
      
      // Broadcast to room
      state.peer.emit('telemetry', payload.payload);
      
    }, 100);

    // Maintenance loop (clean stale nodes)
    setInterval(() => {
      const now = Date.now();
      Object.keys(state.remoteNodes).forEach(peerId => {
        if (now - state.remoteNodes[peerId].lastUpdate > 5000) {
          // Node hasn't reported in 5s, remove
          delete state.remoteNodes[peerId];
          if (state.markers[peerId]) {
            state.map.removeLayer(state.markers[peerId]);
            delete state.markers[peerId];
          }
          updateRoster();
        }
      });
      updateRoster(); // regular UI refresh
    }, 1000);

  } else {
    state.isBroadcasting = false;
    btns.startBroadcast.textContent = "START BROADCAST";
    btns.startBroadcast.classList.remove('btn-outline');
    btns.startBroadcast.classList.add('btn-primary');
    clearInterval(broadcastInterval);
    updateRoster();
  }
});

function updateRoster() {
  ui.rosterList.innerHTML = '';
  
  const connectedPeers = Object.keys(state.remoteNodes).length;
  
  if (!state.isBroadcasting && connectedPeers === 0) {
    ui.rosterList.innerHTML = '<li class="empty-roster">No active nodes</li>';
    return;
  }

  // Add self
  if (state.isBroadcasting) {
    const selfLi = document.createElement('li');
    selfLi.innerHTML = `<strong>${state.unitId} (You)</strong> - 10Hz`;
    ui.rosterList.appendChild(selfLi);
  }

  // Add remote nodes
  Object.keys(state.remoteNodes).forEach(peerId => {
    const node = state.remoteNodes[peerId];
    const li = document.createElement('li');
    li.innerHTML = `<strong>${node.unitId}</strong> - 10Hz <br><span style="font-size:0.7rem; color:var(--text-dim)">Dist: ${node.distance.toFixed(1)}m</span>`;
    ui.rosterList.appendChild(li);
  });
}


// --- Map Logic ---
function initMap() {
  if (state.map) {
    state.map.invalidateSize();
    return;
  }

  const lat = state.gpsData.lat || 37.7749;
  const lng = state.gpsData.lng || -122.4194;

  state.map = L.map('map', { zoomControl: false, attributionControl: false }).setView([lat, lng], 16);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(state.map);

  if (state.gpsData.lat) {
    updateMyMapPosition();
  }
}

function updateMyMapPosition() {
  if (!state.map || state.gpsData.lat === null) return;

  const latlng = [state.gpsData.lat, state.gpsData.lng];
  
  if (!state.markers['self']) {
    const icon = L.divIcon({ className: 'custom-marker self', iconSize: [24, 24], iconAnchor: [12, 12] });
    state.markers['self'] = L.marker(latlng, { icon }).addTo(state.map);
    state.map.setView(latlng, 17);
  } else {
    state.markers['self'].setLatLng(latlng);
  }
}

function updateRemoteMarker(peerId, payload) {
  if (!state.map) return;
  const latlng = [payload.lat, payload.lng];
  
  if (!state.markers[peerId]) {
    const icon = L.divIcon({ className: 'custom-marker', iconSize: [20, 20], iconAnchor: [10, 10] });
    state.markers[peerId] = L.marker(latlng, { icon }).addTo(state.map);
  } else {
    state.markers[peerId].setLatLng(latlng);
  }
}


// --- Math / Math Utils ---
function calculateDistance(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lat2 == null) return Infinity;
  const R = 6371e3; 
  const φ1 = lat1 * Math.PI/180;
  const φ2 = lat2 * Math.PI/180;
  const Δφ = (lat2-lat1) * Math.PI/180;
  const Δλ = (lon2-lon1) * Math.PI/180;
  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c; 
}

function calculateHeading(lat1, lon1, lat2, lon2) {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const lat1Rad = lat1 * Math.PI / 180;
  const lat2Rad = lat2 * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
  let brng = Math.atan2(y, x) * 180 / Math.PI;
  return (brng + 360) % 360;
}


// --- Collision Engine ---
function runCollisionEngine() {
  ui.collisionAlerts.innerHTML = '';
  let minTTC = Infinity;
  let criticalNode = null;
  
  Object.values(state.remoteNodes).forEach(node => {
    // Advanced TTC algorithm considering trajectories
    // If heading difference is ~180, head-on. If ~0, following.
    const headingDiff = Math.abs(state.gpsData.heading - node.heading);
    let relativeSpeed = 0;
    
    // Simplistic relative speed calculation based on heading difference
    if (headingDiff > 90 && headingDiff < 270) {
      // Approaching each other
      relativeSpeed = node.spd + (state.gpsData.spd || 0);
    } else {
      // Same direction, difference in speeds
      relativeSpeed = Math.abs(node.spd - (state.gpsData.spd || 0));
    }
    
    // Add small default relative speed if 0 to avoid Infinity division, if distance is shrinking
    if (relativeSpeed < 1) relativeSpeed = 1; 

    let ttc = Infinity;
    
    if (node.distance < 1000) { 
       ttc = node.distance / relativeSpeed;
    }
    
    if (ttc < minTTC) {
      minTTC = ttc;
      criticalNode = node;
    }
  });
  
  if (minTTC < 5) {
    ui.collisionAlerts.innerHTML = `
      <div class="alert-item danger">
        <span>COLLISION WARNING: ${criticalNode.unitId}</span>
        <span class="ttc-val">TTC: ${minTTC.toFixed(1)}s</span>
      </div>
    `;
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  } else if (minTTC < 15) {
    ui.collisionAlerts.innerHTML = `
      <div class="alert-item" style="background: rgba(255, 165, 0, 0.2); border: 1px solid rgba(255, 165, 0, 0.5); color: orange;">
        <span>CAUTION: ${criticalNode.unitId} APPROACHING</span>
        <span class="ttc-val">TTC: ${minTTC.toFixed(1)}s</span>
      </div>
    `;
  } else {
    ui.collisionAlerts.innerHTML = `
      <div class="alert-item safe">
        <span>Pairwise TTC Calculations Active</span>
        <span class="ttc-val">SAFE</span>
      </div>
    `;
  }
}

// --- Geofence Logic ---
btns.setGeofence.addEventListener('click', () => {
  if (state.gpsData.lat === null) {
    alert("No GPS fix yet. Enable uplink first.");
    return;
  }
  
  state.geofence.lat = state.gpsData.lat;
  state.geofence.lng = state.gpsData.lng;
  state.geofence.radius = parseFloat(ui.geofenceRadius.value) || 500;
  state.geofence.active = true;
  
  if (state.geofence.circleLayer && state.map) {
    state.map.removeLayer(state.geofence.circleLayer);
  }
  
  if (state.map) {
    state.geofence.circleLayer = L.circle([state.geofence.lat, state.geofence.lng], {
      color: '#3b82f6',
      fillColor: '#3b82f6',
      fillOpacity: 0.1,
      radius: state.geofence.radius
    }).addTo(state.map);
  }
  
  btns.setGeofence.style.display = 'none';
  btns.clearGeofence.style.display = 'block';
  
  checkGeofence();
});

btns.clearGeofence.addEventListener('click', () => {
  state.geofence.active = false;
  
  if (state.geofence.circleLayer && state.map) {
    state.map.removeLayer(state.geofence.circleLayer);
    state.geofence.circleLayer = null;
  }
  
  btns.setGeofence.style.display = 'block';
  btns.clearGeofence.style.display = 'none';
  
  ui.geofenceAlerts.innerHTML = `
    <div class="alert-item safe">
      <span>Geo Fence Inactive</span>
      <span class="ttc-val">OFF</span>
    </div>
  `;
});

ui.geofenceRadius.addEventListener('change', () => {
  if (state.geofence.active) {
    btns.setGeofence.click(); // Reset geofence with new radius
  }
});

function checkGeofence() {
  if (!state.geofence.active || state.gpsData.lat === null) return;
  
  const dist = calculateDistance(state.gpsData.lat, state.gpsData.lng, state.geofence.lat, state.geofence.lng);
  
  if (dist > state.geofence.radius) {
    ui.geofenceAlerts.innerHTML = `
      <div class="alert-item danger">
        <span>GEOFENCE BREACHED</span>
        <span class="ttc-val">OUTSIDE ZONE</span>
      </div>
    `;
    if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 100]);
  } else {
    ui.geofenceAlerts.innerHTML = `
      <div class="alert-item safe">
        <span>Inside Geo Fence Zone</span>
        <span class="ttc-val">SAFE</span>
      </div>
    `;
  }
}
