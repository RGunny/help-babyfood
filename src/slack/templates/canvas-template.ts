/** The kinds of canvas the server keeps. Stored with each canvas in `slack_canvas.template_version`'s row. */
export type CanvasTemplateKey = 'household_board';

/**
 * One canvas layout. Same contract as `MessageTemplate` (ADR 0007), with markdown as the output:
 * pure, versioned by hand, pinned by a snapshot test. Canvases take no Block Kit, so a canvas
 * template and a message template cannot share an output type.
 */
export interface CanvasTemplate<Input> {
  readonly key: CanvasTemplateKey;
  readonly version: number;
  render(input: Input): string;
}
