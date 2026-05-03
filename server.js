import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: "*" }
  });

  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });

  app.use(vite.middlewares);

  io.on('connection', (socket) => {
    console.log('Device connected:', socket.id);
    socket.join('v2x-room');

    socket.on('telemetry', (data) => {
      socket.to('v2x-room').emit('telemetry', { peerId: socket.id, payload: data });
    });

    socket.on('disconnect', () => {
      console.log('Device disconnected:', socket.id);
      io.to('v2x-room').emit('peer_disconnected', socket.id);
    });
  });

  const port = process.env.PORT || 3000;
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on http://localhost:${port}`);
    console.log(`Network access enabled for multi-device broadcast`);
  });
}

startServer();
