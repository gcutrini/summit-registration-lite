import RegistrationLiteReducer from '../reducer';
import { GET_TICKET_TYPES, LOAD_INITIAL_VARS } from '../actions';

// Which tickets a promo code changed is written with the catalog it describes
// and replaced by every fetch, which is why nothing clears it explicitly. That
// only holds while each fetch really does overwrite it: a fetch carrying no
// affected ids has to empty the field, not leave the last answer standing for a
// catalog it no longer describes.

const catalog = (data, affected) => RegistrationLiteReducer(undefined, {
    type: GET_TICKET_TYPES,
    payload: { response: { data }, ticketTypesAffectedByPromoCode: affected },
});

const refetch = (state, data, affected) => RegistrationLiteReducer(state, {
    type: GET_TICKET_TYPES,
    payload: { response: { data }, ticketTypesAffectedByPromoCode: affected },
});

const ticket = (id) => ({ id, name: `Ticket ${id}` });

describe('ticket types affected by the applied promo code', () => {
    it('records what the fetch reported', () => {
        const state = catalog([ticket(1), ticket(2)], [2]);
        expect(state.ticketTypesAffectedByPromoCode).toEqual([2]);
    });

    it('empties on a fetch that reports none, rather than keeping the last answer', () => {
        // Removing a code refetches without it. Keeping the previous ids here
        // would pre-select a ticket for a code that is no longer applied.
        let state = catalog([ticket(1), ticket(2)], [2]);
        state = refetch(state, [ticket(1)], []);
        expect(state.ticketTypesAffectedByPromoCode).toEqual([]);
    });

    it('empties when the fetch reports nothing at all', () => {
        // Every other caller of getTicketTypes omits the field entirely.
        let state = catalog([ticket(1)], [1]);
        state = RegistrationLiteReducer(state, {
            type: GET_TICKET_TYPES,
            payload: { response: { data: [ticket(1)] } },
        });
        expect(state.ticketTypesAffectedByPromoCode).toEqual([]);
    });

    it('does not survive the widget being loaded for a summit', () => {
        let state = catalog([ticket(1)], [1]);
        state = RegistrationLiteReducer(state, {
            type: LOAD_INITIAL_VARS,
            payload: { summitData: { id: 7 }, apiBaseUrl: 'x', profileData: null },
        });
        expect(state.ticketTypesAffectedByPromoCode).toEqual([]);
    });
});
