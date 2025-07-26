import { defineType } from './node';
import { Call, type CallValue } from './call';
import { type Quoted } from './quoted';
import { type UrlValue } from './general';

// export type ThisUrlValue = CallValue & {
//   value: Quoted | UrlValue
// }
/**
 * e.g. url('foo.png')
 *
 * @todo - I don't think Url actually extends Call,
 * I think it just looks function-like, but the value
 * is just a General or Quoted.
 */
export class Url extends Call {
  /**
   * @todo - enable URL rewriting
   */
}

export const url = defineType(Url, 'Url');