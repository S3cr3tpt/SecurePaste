import sqlite3
import uuid
import datetime
import secrets
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Depends, Header
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, field_validator
from typing import List, Dict, Optional

# --- CONFIGURATION ---
DB_NAME = "pastes.db"
MAX_PASTE_SIZE = 10_000
PASTE_TTL_MINUTES = 60
VALID_ADMIN_TOKENS = set()

print("--- SYSTEM: Script Loaded ---")  # DEBUG LINE 1

# --- DATABASE SETUP  ---
def init_db():
    print(f"--- SYSTEM: Connecting to {DB_NAME}... ---") # DEBUG LINE 2
    try:
        conn = sqlite3.connect(DB_NAME, timeout=5.0) # 5 second timeout to prevent infinite hang
        c = conn.cursor()
        c.execute('''CREATE TABLE IF NOT EXISTS pastes 
                     (id TEXT PRIMARY KEY, content TEXT, views_left INTEGER, created_at TIMESTAMP)''')
        conn.commit()
        conn.close()
        print("--- SYSTEM: Database Connection Successful ---") # DEBUG LINE 3
    except Exception as e:
        print(f"!!! CRITICAL ERROR: Database Failed: {e}")

# --- LIFESPAN MANAGER ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup logic
    init_db()
    yield
    # Shutdown logi
    print("--- SYSTEM: Shutting Down ---")

app = FastAPI(lifespan=lifespan)

# --- HELPER: DATABASE JANITOR ---
def cleanup_old_data():
    try:
        conn = sqlite3.connect(DB_NAME, timeout=1.0)
        c = conn.cursor()
        cutoff = datetime.datetime.now() - datetime.timedelta(minutes=PASTE_TTL_MINUTES)
        c.execute('DELETE FROM pastes WHERE created_at < ?', (cutoff.isoformat(),))
        conn.commit()
        conn.close()
    except:
        pass # Fail silently if DB is locked, don't crash the request

# --- SECURITY: CUSTOM TOKEN AUTH ---
class LoginRequest(BaseModel):
    username: str
    password: str

@app.post("/api/admin/login")
async def admin_login(creds: LoginRequest):
    if creds.username == "admin" and creds.password == "admin":
        token = secrets.token_hex(16)
        VALID_ADMIN_TOKENS.add(token)
        return {"token": token}
    raise HTTPException(status_code=401, detail="Invalid Credentials")

async def verify_admin(x_admin_token: Optional[str] = Header(None)):
    if x_admin_token not in VALID_ADMIN_TOKENS:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return True

# --- 1. PASTE LOGIC ---
class Paste(BaseModel):
    content: str
    is_burn_after_reading: bool = False

    @field_validator('content')
    def check_size(cls, v):
        if len(v) > MAX_PASTE_SIZE: raise ValueError('Payload too large.')
        return v

@app.post("/api/pastes")
async def create_paste(paste: Paste):
    cleanup_old_data()
    paste_id = str(uuid.uuid4())[:8]
    views = 1 if paste.is_burn_after_reading else -1
    now = datetime.datetime.now().isoformat()
    
    conn = sqlite3.connect(DB_NAME)
    c = conn.cursor()
    c.execute('INSERT INTO pastes VALUES (?, ?, ?, ?)', (paste_id, paste.content, views, now))
    conn.commit()
    conn.close()
    return {"id": paste_id}

@app.get("/api/pastes/{paste_id}")
async def get_paste(paste_id: str):
    cleanup_old_data()
    conn = sqlite3.connect(DB_NAME)
    c = conn.cursor()
    c.execute('SELECT content, views_left FROM pastes WHERE id = ?', (paste_id,))
    row = c.fetchone()
    
    if row is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Paste not found.")
    
    content, views_left = row
    if views_left > 0:
        new_views = views_left - 1
        if new_views == 0:
            c.execute('DELETE FROM pastes WHERE id = ?', (paste_id,))
        else:
            c.execute('UPDATE pastes SET views_left = ? WHERE id = ?', (new_views, paste_id))
        conn.commit()
    conn.close()
    return {"content": content}

# --- 2. CHAT LOGIC ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}
        self.room_stats: Dict[str, datetime.datetime] = {}

    async def connect(self, websocket: WebSocket, room_id: str):
        await websocket.accept()
        current = self.active_connections.get(room_id, [])
        if len(current) >= 2:
            await websocket.send_text("SYSTEM_ERROR: Room Full.")
            await websocket.close()
            return False
        if room_id not in self.active_connections:
            self.active_connections[room_id] = []
            self.room_stats[room_id] = datetime.datetime.now()
        self.active_connections[room_id].append(websocket)
        return True

    def disconnect(self, websocket: WebSocket, room_id: str):
        if room_id in self.active_connections:
            if websocket in self.active_connections[room_id]:
                self.active_connections[room_id].remove(websocket)
            if not self.active_connections[room_id]:
                del self.active_connections[room_id]
                if room_id in self.room_stats: del self.room_stats[room_id]

    async def broadcast(self, message: str, room_id: str, sender: WebSocket):
        if room_id in self.active_connections:
            for connection in self.active_connections[room_id]:
                if connection != sender: await connection.send_text(message)

    async def nuke_room(self, room_id: str):
        if room_id in self.active_connections:
            for connection in self.active_connections[room_id]:
                await connection.send_text("SYSTEM_NUKE:")
                await connection.close()
            del self.active_connections[room_id]
            if room_id in self.room_stats: del self.room_stats[room_id]

manager = ConnectionManager()

@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str):
    success = await manager.connect(websocket, room_id)
    if not success: return
    try:
        while True:
            data = await websocket.receive_text()
            await manager.broadcast(data, room_id, websocket)
    except WebSocketDisconnect:
        manager.disconnect(websocket, room_id)

@app.post("/api/chat/nuke")
async def nuke_chat(req: dict):
    await manager.nuke_room(req.get("room_id"))
    return {"status": "destroyed"}

# --- 3. ADMIN DASHBOARD ---
@app.get("/api/admin/stats")
async def get_stats(authorized: bool = Depends(verify_admin)):
    cleanup_old_data()
    
    chat_data = []
    for room_id, sockets in manager.active_connections.items():
        start_time = manager.room_stats.get(room_id, datetime.datetime.now())
        duration = str(datetime.datetime.now() - start_time).split('.')[0]
        chat_data.append({"room_id": room_id, "users": len(sockets), "duration": duration})

    conn = sqlite3.connect(DB_NAME)
    c = conn.cursor()
    c.execute('SELECT id, views_left, created_at FROM pastes')
    rows = c.fetchall()
    conn.close()
    
    paste_data = []
    for r in rows:
        paste_data.append({"id": r[0], "views": "1 (Burn)" if r[1] == 1 else "1 Hour TTL", "created_at": r[2]})

    return {"chats": chat_data, "pastes": paste_data}

app.mount("/", StaticFiles(directory="static", html=True), name="static")