// View tab, part ⑤ Arch: the combined arch of the view and of its search view, re-indented and coloured. Collapsible:
// the code, once everything above has pointed at what to look for. Each view's own arch is in part ②.
import { _t } from '../../i18n/i18n.ts';
import { block, fill } from '../../ui/cards.ts';
import { xmlCode } from '../../ui/code.ts';
import { prettyXml } from '../../ui/xml.ts';
import type { Composition } from './view.data.ts';
import { frag, note, segmented } from '../../ui/parts.ts';
import { tpl } from './view.ui.ts';

export function archPart(parent: HTMLElement, comps: { type: string; promise: Promise<Composition | null> }[]) {
  block(parent, 'arch', _t('Combined arch'), () => {
    const slot = tpl('slot', { slot: HTMLDivElement }).refs.slot;
    const show = (type: string) => fill(slot, async () => {
      const comp = await comps.find((c) => c.type === type)!.promise;
      if (!comp) return note(_t('No %s view.', type));
      // Odoo returns it combined, its indentation a mix of every view's: re-indented to be read
      return frag(note(_t('View #%s with all extensions applied, as the webclient gets it: elements of groups you\'re not in are removed.', comp.view.id)),
        xmlCode(prettyXml(comp.view.arch)).root);
    });
    show(comps[0]!.type);
    return frag(comps.length > 1 ? segmented(comps.map((c) => [c.type, c.type] as [string, string]), comps[0]!.type, show) : null, slot);
  }, '5');
}
