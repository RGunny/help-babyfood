import type { NodeMcpRequestHandler } from '@modelcontextprotocol/node';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, type McpHttpHandler } from '@modelcontextprotocol/server';
import { callerOf } from './auth/caller.js';
import { buildServer, ToolDeps } from './server.factory.js';

export const MCP_HANDLER = Symbol('McpHttpHandler');
export const MCP_NODE_HANDLER = Symbol('McpNodeHandler');

export type McpNodeHandler = NodeMcpRequestHandler;

/**
 * One handler for the whole process.
 *
 * The factory inside runs once per HTTP request and builds a fresh `McpServer` around that
 * request's caller, so nothing is shared between requests and the endpoint stays stateless. The
 * consistency boundary is still the household row lock, as it has been since stage 2.
 */
export function createHandler(deps: ToolDeps): McpHttpHandler {
  return createMcpHandler((context) => buildServer(deps, callerOf(context.authInfo)));
}

export function createNodeHandler(handler: McpHttpHandler): McpNodeHandler {
  return toNodeHandler(handler);
}
