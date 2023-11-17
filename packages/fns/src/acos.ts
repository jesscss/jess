import { mathHelper } from './util/mathHelper'

export default mathHelper.bind(null, Math.acos, ['value'], 'rad')
