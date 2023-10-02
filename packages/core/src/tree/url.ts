import { defineType } from './node'
import { Call, type CallValue } from './call'
import { type Quoted } from './quoted'
import { type Anonymous } from './anonymous'

export type UrlValue = CallValue & {
  value: Quoted | Anonymous
}
/**
 * e.g. url('foo.png')
 */
export class Url extends Call<UrlValue> {
  /**
   * @todo - enable URL rewriting
   */
}

export const call = defineType<UrlValue>(Url, 'Call')