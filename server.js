
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;

const rooms = new Map();

const weaponTypes = [
  { name: "Pillow", damage: 8, range: 60, cooldown: 600, symbol: "🛏️" },
  { name: "Stick", damage: 12, range: 65, cooldown: 650, symbol: "🪵" },
  { name: "Ruler", damage: 15, range: 70, cooldown: 550, symbol: "📏" },
  { name: "Toy Sword", damage: 18, range: 70, cooldown: 750, symbol: "🗡️" },
  { name: "Bat", damage: 22, range: 75, cooldown: 850, symbol: "🏏" },
  { name: "Hammer", damage: 26, range: 65, cooldown: 900, symbol: "🔨" },
  { name: "Spear", damage: 30, range: 100, cooldown: 1000, symbol: "🔱" },
  { name: "Axe", damage: 35, range: 75, cooldown: 1100, symbol: "🪓" },
  { name: "Mega Pillow", damage: 40, range: 40, cooldown: 100, symbol: "💥" },
  { name: "Delete Button", damage: 100000, range: 5000, cooldown: 1234567890, symbol: "❓" }
];

function randomCode() {
  let code;

  do {
    code = "LOFO-" + Math.floor(1000 + Math.random() * 9000);
  } while (rooms.has(code));

  return code;
}

function randomWeapon() {
  return { ...weaponTypes[Math.floor(Math.random() * weaponTypes.length)] };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function publicRoomData(room) {
  return {
    code: room.code,
    name: room.settings.name,
    visibility: room.settings.visibility,
    players: room.players.size,
    maxPlayers: room.settings.maxPlayers,
    started: room.started
  };
}

function emitRoom(room) {
  io.to(room.code).emit("roomUpdate", {
    players: [...room.players.values()],
    host: room.host,
    settings: room.settings,
    started: room.started,
    lightOn: room.lightOn,
    weapons: room.weapons
  });
}

function emitPublicRooms() {
  const list = [...rooms.values()]
    .filter(r => r.settings.visibility === "Public")
    .map(publicRoomData);

  io.emit("publicRooms", list);
}

function createRoom(socket, data) {
  if (socket.data.room) return;

  const settings = {
    name: String(data.name || "Untitled Arena").slice(0, 30),
    visibility: data.visibility === "Private" ? "Private" : "Public",
    maxPlayers: Math.max(2, Math.min(16, Number(data.maxPlayers) || 8)),
    npcCount: Math.max(0, Math.min(15, Number(data.npcCount) || 0)),
    hp: Math.max(100, Math.min(1000, Number(data.hp) || 500)),
    lightMode: ["Random", "Always ON", "Always OFF"].includes(data.lightMode)
      ? data.lightMode : "Random",
    weapons: ["All weapons", "Basic weapons", "No weapons"].includes(data.weapons)
      ? data.weapons : "All weapons",
    friendlyFire: data.friendlyFire === true
  };

  const code = randomCode();

  const room = {
    code,
    host: socket.id,
    settings,
    players: new Map(),
    weapons: [],
    started: false,
    lightOn: true,
    lightTimer: 0,
    nextLightChange: 3000,
    lastTick: Date.now()
  };

  rooms.set(code, room);
  joinRoom(socket, room, data.username);

  emitPublicRooms();
}

function joinRoom(socket, room, username) {
  if (socket.data.room) return false;

  if (room.started) {
    socket.emit("errorMessage", "This match has already started.");
    return false;
  }

  if (room.players.size >= room.settings.maxPlayers) {
    socket.emit("errorMessage", "This room is full.");
    return false;
  }

  const player = {
    id: socket.id,
    username: String(username || "Player").trim().slice(0, 18) || "Player",
    x: 100 + Math.random() * 700,
    y: 100 + Math.random() * 350,
    radius: 18,
    hp: room.settings.hp,
    maxHp: room.settings.hp,
    speed: 3.2,
    weapon: null,
    attackCooldown: 0,
    alive: true,
    input: {}
  };

  room.players.set(socket.id, player);
  socket.data.room = room.code;
  socket.join(room.code);

  socket.emit("joinedRoom", {
    code: room.code,
    playerId: socket.id,
    isHost: room.host === socket.id
  });

  emitRoom(room);
  emitPublicRooms();

  return true;
}

function leaveRoom(socket) {
  const code = socket.data.room;
  if (!code) return;

  const room = rooms.get(code);
  socket.leave(code);
  delete socket.data.room;

  if (!room) return;

  room.players.delete(socket.id);

  if (room.players.size === 0) {
    rooms.delete(code);
  } else {
    if (room.host === socket.id) {
      room.host = room.players.keys().next().value;
    }

    emitRoom(room);
  }

  emitPublicRooms();
}

function startMatch(room) {
  if (room.started) return;

  room.started = true;
  room.lightOn = true;
  room.lightTimer = 0;

  room.weapons = [];

  if (room.settings.weapons !== "No weapons") {
    for (let i = 0; i < 7; i++) {
      room.weapons.push({
        id: Math.random().toString(36).slice(2),
        x: 50 + Math.random() * 800,
        y: 70 + Math.random() * 420,
        type: randomWeapon()
      });
    }
  }

  for (const player of room.players.values()) {
    player.hp = room.settings.hp;
    player.alive = true;
    player.weapon = null;
    player.x = 100 + Math.random() * 700;
    player.y = 100 + Math.random() * 350;
    player.attackCooldown = 0;
  }

  if (room.settings.lightMode === "Always ON") {
    room.lightOn = true;
  } else if (room.settings.lightMode === "Always OFF") {
    room.lightOn = false;
  }

  io.to(room.code).emit("matchStarted");
  emitRoom(room);
}

io.on("connection", socket => {
  console.log("Connected:", socket.id);

  socket.on("createRoom", data => {
    createRoom(socket, data || {});
  });

  socket.on("joinRoom", data => {
    const code = String(data.code || "").trim().toUpperCase();
    const room = rooms.get(code);

    if (!room) {
      socket.emit("errorMessage", "Room not found.");
      return;
    }

    joinRoom(socket, room, data.username);
  });

  socket.on("getPublicRooms", () => {
    socket.emit("publicRooms", [...rooms.values()]
      .filter(r => r.settings.visibility === "Public")
      .map(publicRoomData));
  });

  socket.on("leaveRoom", () => {
    leaveRoom(socket);
  });

  socket.on("startMatch", () => {
    const room = rooms.get(socket.data.room);

    if (!room || room.host !== socket.id) return;

    startMatch(room);
  });

  socket.on("updateSettings", data => {
    const room = rooms.get(socket.data.room);

    if (!room || room.host !== socket.id || room.started) return;

    const s = room.settings;

    if (data.name !== undefined)
      s.name = String(data.name).slice(0, 30);

    if (data.visibility !== undefined)
      s.visibility = data.visibility === "Private" ? "Private" : "Public";

    if (data.maxPlayers !== undefined)
      s.maxPlayers = Math.max(2, Math.min(16, Number(data.maxPlayers)));

    if (data.npcCount !== undefined)
      s.npcCount = Math.max(0, Math.min(15, Number(data.npcCount)));

    if (data.hp !== undefined)
      s.hp = Math.max(100, Math.min(1000, Number(data.hp)));

    if (data.lightMode !== undefined &&
        ["Random", "Always ON", "Always OFF"].includes(data.lightMode))
      s.lightMode = data.lightMode;

    if (data.weapons !== undefined &&
        ["All weapons", "Basic weapons", "No weapons"].includes(data.weapons))
      s.weapons = data.weapons;

    if (data.friendlyFire !== undefined)
      s.friendlyFire = data.friendlyFire === true;

    emitRoom(room);
    emitPublicRooms();
  });

  socket.on("input", input => {
    const room = rooms.get(socket.data.room);
    if (!room || !room.started) return;

    const player = room.players.get(socket.id);
    if (!player || !player.alive) return;

    player.input = {
      up: !!input.up,
      down: !!input.down,
      left: !!input.left,
      right: !!input.right,
      attack: !!input.attack,
      pickup: !!input.pickup,
      drop: !!input.drop
    };
  });

  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);
    leaveRoom(socket);
  });
});

function endMatch(room, message) {
  room.started = false;
  io.to(room.code).emit("matchEnded", message);
  emitRoom(room);
}

setInterval(() => {
  const now = Date.now();

  for (const room of rooms.values()) {
    if (!room.started) continue;

    const dt = Math.min(now - room.lastTick, 100);
    room.lastTick = now;

    if (room.settings.lightMode === "Random") {
      room.lightTimer += dt;

      if (room.lightTimer >= room.nextLightChange) {
        room.lightTimer = 0;
        room.lightOn = !room.lightOn;
        room.nextLightChange = 2000 + Math.random() * 3000;
      }
    }

    if (!room.lightOn) {
      for (const player of room.players.values()) {
        if (!player.alive) continue;

        const input = player.input;
        let dx = Number(input.right) - Number(input.left);
        let dy = Number(input.down) - Number(input.up);

        const length = Math.hypot(dx, dy);

        if (length) {
          dx /= length;
          dy /= length;
        }

        player.x = Math.max(player.radius, Math.min(900 - player.radius,
          player.x + dx * player.speed * (dt / 16.67)));

        player.y = Math.max(40 + player.radius, Math.min(550 - player.radius,
          player.y + dy * player.speed * (dt / 16.67)));

        player.attackCooldown = Math.max(0, player.attackCooldown - dt);

        if (input.pickup && !player.weapon) {
          const weaponIndex = room.weapons.findIndex(w =>
            distance(player, w) < 45
          );

          if (weaponIndex !== -1) {
            player.weapon = room.weapons[weaponIndex].type;
            room.weapons.splice(weaponIndex, 1);
          }
        }

        if (input.drop && player.weapon) {
          room.weapons.push({
            id: Math.random().toString(36).slice(2),
            x: player.x,
            y: player.y,
            type: player.weapon
          });

          player.weapon = null;
        }

        if (input.attack && player.weapon && player.attackCooldown <= 0) {
          player.attackCooldown = player.weapon.cooldown;

          for (const target of room.players.values()) {
            if (target.id === player.id || !target.alive) continue;
            if (room.settings.friendlyFire) continue;

            if (distance(player, target) <= player.weapon.range) {
              target.hp = Math.max(0, target.hp - player.weapon.damage);

              if (target.hp <= 0) {
                target.alive = false;
              }
            }
          }
        }
      }
    }

    const alive = [...room.players.values()].filter(p => p.alive);

    if (alive.length <= 1 && room.players.size > 1) {
      endMatch(room, alive.length === 1
        ? alive[0].username + " wins!"
        : "Everyone was defeated!");
      continue;
    }

    io.to(room.code).emit("gameState", {
      players: [...room.players.values()],
      weapons: room.weapons,
      lightOn: room.lightOn
    });
  }
}, 50);

server.listen(PORT, "0.0.0.0", () => {
  console.log("LIGHT OFF FIGHT ON running on port " + PORT);
});
