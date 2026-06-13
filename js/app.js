import {state} from './core/state.js';
import {renderCommandCenter} from './ui/commandCenter.js';
import {renderHotList} from './ui/alphaHotList.js';
renderCommandCenter(state);
renderHotList(state);
