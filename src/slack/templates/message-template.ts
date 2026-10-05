import { SlackMessage } from './blocks.js';

/** The kinds of message the server posts. Stored with each snapshot in `slack_message.template_key`. */
export type TemplateKey = 'daily_brief' | 'reaction_prompt' | 'stock_alert';

/**
 * One message layout. Pure: it knows neither the network nor the store, so the same input always
 * gives the same payload and a snapshot test can pin it.
 *
 * `version` is raised by hand whenever the layout changes. It is stored beside each message sent,
 * so that a snapshot from before a change can be told apart from one after it (ADR 0007).
 */
export interface MessageTemplate<Input> {
  readonly key: TemplateKey;
  readonly version: number;
  render(input: Input): SlackMessage;
}
