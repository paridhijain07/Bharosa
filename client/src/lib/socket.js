import { io } from 'socket.io-client';

const socketUrl = import.meta.env.VITE_API_URL || window.location.origin;

export const socket = io(socketUrl, {
  autoConnect: true,
  reconnection: true,
});

