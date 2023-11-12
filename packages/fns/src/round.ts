import { mathHelper } from './_mathHelper'
import lodashRound from 'lodash-es/round'
import { type ExtendedFn } from './_util'

const round: ExtendedFn = mathHelper.bind(null, lodashRound, ['value', 'precision'], undefined)

export default round
