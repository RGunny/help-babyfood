import { All, Controller, Inject, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { McpNodeHandler } from './mcp.handler.js';
import { MCP_NODE_HANDLER } from './mcp.handler.js';

/**
 * The one MCP endpoint.
 *
 * Nest owns the Express app, so the SDK's `createMcpExpressApp` is not used; what it would have
 * armed — the JSON body parser, the Host and Origin checks — is armed by Nest itself and by
 * `McpModule`'s middleware. Every method goes to the same handler: the transport answers POST,
 * GET and DELETE on one path.
 */
@Controller('mcp')
export class McpController {
  constructor(@Inject(MCP_NODE_HANDLER) private readonly handler: McpNodeHandler) {}

  @All()
  async handle(@Req() request: Request, @Res() response: Response): Promise<void> {
    // Nest가 이미 본문을 읽었다. 그대로 넘기지 않으면 어댑터가 빈 스트림을 다시 읽는다.
    await this.handler(request, response, request.body);
  }
}
