import { startViewer } from './app.ts';
import { Connection, gameSocketUrl } from './net.ts';

startViewer((onMessage, onOpenChange) => new Connection(gameSocketUrl(window.location), onMessage, onOpenChange));
