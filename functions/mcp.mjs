// Cloudflare Pages Function served at /mcp. The logic lives in mcp/server.mjs
// so Node can test it without the Workers runtime.
import { handleRequest } from '../mcp/server.mjs';

export const onRequest = ({ request, env }) => handleRequest(request, env);
