import { mathHelper } from './util/mathHelper'
import lodashRound from 'lodash-es/round'
import { type ExtendedFn } from './util'

const round: ExtendedFn = mathHelper.bind(null, lodashRound, ['value', 'precision'], undefined)

export default round
