// View tab: the pieces its parts share. Markup: view.tpl.html.
import { translateDom } from '../../i18n/i18n.ts';
import { templates } from '../../ui/template.ts';
import html from './view.tpl.html';

export const tpl = templates(html, translateDom);

/** A view by its xmlid without the module (it shows apart), else by id. */
export const shortName = (xmlId: string | false, id: number) => (xmlId ? xmlId.split('.').slice(1).join('.') : `#${id}`);
