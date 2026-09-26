import { ReactionPrompt } from '../../application/ports/brief-delivery.port.js';
import { actionId, encodeReaction } from '../actions.js';
import { MAX_BLOCKS, SlackBlock, actions, button, escape, linesSection } from './blocks.js';
import { SLOT_LABEL } from './labels.js';
import { MessageTemplate } from './message-template.js';

/**
 * The follow-up of 4.6: two buttons per new ingredient of the meal just fed.
 *
 * Each ingredient gets an actions block of its own. Its two buttons are then the only ones in the
 * block, which keeps the action ids unique there. A meal would need 49 new ingredients to reach
 * the block limit; past that the rest get no button and stay in the next brief as unrecorded.
 */
export const reactionPromptTemplate: MessageTemplate<ReactionPrompt> = {
  key: 'reaction_prompt',
  version: 1,
  render(prompt) {
    const title = `${prompt.date} ${SLOT_LABEL[prompt.slot]} 새 재료 반응 기록`;
    const blocks: SlackBlock[] = [
      linesSection(
        title,
        prompt.ingredients.map((entry) => `• ${escape(entry.name)} (${entry.exposureNumber}회차)`),
      ),
    ];
    // 머리 section 하나를 뺀 나머지가 재료마다 actions 블록 하나씩이다.
    for (const entry of prompt.ingredients.slice(0, MAX_BLOCKS - 1)) {
      blocks.push(
        actions([
          button(
            actionId('reaction', 0),
            `${entry.name} 이상 없음`,
            encodeReaction(prompt.date, prompt.slot, entry.ingredientId, 'clear'),
          ),
          button(
            actionId('reaction', 1),
            `${entry.name} 반응 있음`,
            encodeReaction(prompt.date, prompt.slot, entry.ingredientId, 'reacted'),
          ),
        ]),
      );
    }
    return { text: title, blocks };
  },
};
