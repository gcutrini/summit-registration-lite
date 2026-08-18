/**
 * Copyright 2020 OpenStack Foundation
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/
import RawHTML from 'openstack-uicore-foundation/lib/components/raw-html'
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSpring, config, animated } from "react-spring";
import { useMeasure } from "react-use";
import T from 'i18n-react';
import styles from "./index.module.scss";
import TicketDropdownComponent from '../ticket-dropdown';
import { isInPersonTicketType } from "../../actions";
import ReactTooltip from 'react-tooltip';
import { formatCurrency } from '../../helpers';
import { getTicketMaxQuantity } from '../../helpers';
import { avoidTooltipOverflow, getTicketCost, getTicketTaxes, hasDiscountApplied, isPrePaidOrder } from '../../utils/utils';

import PromoCodeInput from '../promocode-input';
import TicketNotice from '../ticket-notice';
import { VIEW_ITEM } from '../../utils/constants';

const TicketTypeComponent = ({
    allowedTicketTypes,
    originalTicketTypes, // these are the original ones
    taxTypes,
    isActive,
    changeForm,
    reservation,
    inPersonDisclaimer,
    showMultipleTicketTexts,
    allowPromoCodes,
    promo = {},
    validationError,
    promoCode,
    promoCodeAllowsReassign = true,
    trackViewItem,
    noAllowedTicketsMessage,
}) => {
    const { state: promoState = {}, actions: promoActions = {} } = promo;

    const [ticket, setTicket] = useState(null);
    // Which tickets were on offer just before a manually typed code was applied.
    // Comparing that against the refreshed catalog is the only way to tell what
    // such a code unlocked, since it carries no allowed_ticket_types of its own.
    // Null whenever there is no manual apply to interpret.
    const catalogBeforeApply = useRef(null);
    const [quantity, setQuantity] = useState(1);

    const minQuantity = 1;
    const maxQuantity = getTicketMaxQuantity(ticket, promoState.maxQuantityFromPromo);

    // Clamp quantity when max changes (e.g. per-account limit kicks in after auto-apply).
    // If the cap drops below minQuantity (e.g. cap of 0), use the cap directly rather
    // than flooring at minQuantity, otherwise quantity would end up above the cap.
    useEffect(() => {
        if (!ticket) return;
        if (quantity > maxQuantity) {
            setQuantity(maxQuantity < minQuantity ? 0 : maxQuantity);
        }
    }, [maxQuantity, quantity, ticket]);

    const [ref, { height }] = useMeasure();

    const toggleAnimation = useSpring({
        config: { bounce: 0, ...config.stiff },
        from: { opacity: 0, height: 0 },
        to: {
            opacity: 1,
            height: isActive ? height + 10 : 0,
        }
    });

    useEffect(() => {
        if (reservation && reservation.tickets?.length > 0) {
            setTicket(allowedTicketTypes.find(t => t.id === reservation.tickets[0].ticket_type_id));
            setQuantity(reservation.tickets.length);
        }
    }, [])

    useEffect(() => {
        const ticketSelectionValid = !!ticket && quantity >= minQuantity && quantity <= maxQuantity;
        changeForm({ ticketType: ticket, ticketQuantity: quantity, ticketSelectionValid });
    }, [ticket, quantity, maxQuantity])

    // The single ticket the applied code changed, or null when it changed none
    // or several. A ticket missing from the pre-apply catalog was unlocked by
    // the code, and a discount is whatever the API marked, so the API stays the
    // authority on both.
    //
    // Reading clears the snapshot, and the caller reads on every settled apply
    // whether or not it uses the answer, so one can never survive into a later
    // apply it does not describe.
    const ticketUnlockedOrDiscounted = () => {
        const before = catalogBeforeApply.current;
        catalogBeforeApply.current = null;
        if (!before) return null;
        const affected = allowedTicketTypes.filter(
            t => !before.has(t.id) || hasDiscountApplied(t));
        return affected.length === 1 ? affected[0] : null;
    };

    // Which ticket applying a code should select, or null to leave it to the
    // user. Two kinds of code answer this differently: a discovered one names
    // the tickets it applies to, so that list decides, while a typed one names
    // nothing and what it changed in the catalog decides instead. Discovery
    // runs for every logged in user, so reading the discovered code's list
    // after a typed code was applied would pre-select for a code the user
    // never applied and never look at what the typed one did.
    //
    // Only allowedTicketTypes is ever considered: it is date-filtered, and a
    // ticket outside its sales window cannot be shown in the dropdown, so
    // selecting one would strand the user on a ticket they cannot change.
    const ticketToPreSelect = () => {
        const affected = ticketUnlockedOrDiscounted();
        const named = promoCode === promoState.suggestedCode
            ? allowedTicketTypes.find(promoState.isCodeValidForTicket)
            : affected;
        return named || (allowedTicketTypes.length === 1 ? allowedTicketTypes[0] : null);
    };

    useEffect(() => {
        // When promo code changes, the API returns updated ticket types with/without discount.
        // Sync the selected ticket with the refreshed data.
        if (!ticket) {
            // Defer while applyingCode is true: promoCode is set in the store
            // before the refreshed ticketTypes land, so deciding now would read
            // a stale catalog.
            if (promoCode && !promoState.applyingCode && allowedTicketTypes.length > 0) {
                const toSelect = ticketToPreSelect();
                if (toSelect) handleTicketChange(toSelect);
            } else if (!promoCode && !promoState.applyingCode) {
                // An apply that failed, or a code since cleared, leaves nothing
                // to interpret. Guarded on applyingCode because the code is
                // still empty on the first render of an apply in flight.
                catalogBeforeApply.current = null;
            }
            return;
        }
        // The user has chosen; nothing here may move them. Drop the snapshot so
        // it cannot pre-select later, once they clear that choice themselves.
        catalogBeforeApply.current = null;

        const updatedCurrentTicket = originalTicketTypes.find(t => t?.id === ticket.id);
        if (updatedCurrentTicket) {
            changeForm({ ticketType: updatedCurrentTicket })
            setTicket(updatedCurrentTicket);
        } else {
            setTicket(null);
            setQuantity(minQuantity);
        }
    }, [promoCode, promoState.applyingCode, allowedTicketTypes, originalTicketTypes])

    const showTicketSelector = allowedTicketTypes.length > 0;

    const isPrePaidReservation = useMemo(
        () => reservation ? isPrePaidOrder(reservation) : false,
        [reservation]
    );

    // check if reassignment is allowed by both promo code AND ticket type
    const ticketTypeAllowsReassign = ticket?.allows_to_reassign !== false;
    const canReassign = promoCodeAllowsReassign && ticketTypeAllowsReassign;

    // Per-order cap is interesting only when it's tighter than what inventory
    // would otherwise allow (i.e. the binding constraint on the stepper).
    const ticketPerOrderLimit = useMemo(() => {
        if (!ticket) return null;
        const cap = ticket.max_quantity_per_order;
        const inventory = (ticket.quantity_2_sell || Number.MAX_SAFE_INTEGER) - (ticket.quantity_sold ?? 0);
        return cap != null && cap > 0 && cap < inventory ? cap : null;
    }, [ticket]);

    // Messages composed for the info notice (stacked in display order):
    // (1) promo per-account cap, (2) ticket-type per-order cap, (3) non-transferable.
    const infoMessage = useMemo(() => {
        if (!ticket) return [];
        const lines = [];
        if (promoState.perAccountLimit != null) {
            lines.push(T.translate(
                promoState.perAccountLimit === 1
                    ? 'promo_code.per_account_limit_one'
                    : 'promo_code.per_account_limit_other',
                { limit: promoState.perAccountLimit }
            ));
        }
        if (ticketPerOrderLimit != null) {
            lines.push(T.translate(
                ticketPerOrderLimit === 1
                    ? 'ticket_type.max_per_order_one'
                    : 'ticket_type.max_per_order_other',
                { limit: ticketPerOrderLimit }
            ));
        }
        if (!canReassign) {
            lines.push(T.translate('promo_code.non_transferable'));
        }
        return lines;
    }, [ticket, promoState.perAccountLimit, ticketPerOrderLimit, canReassign]);

    const handleTicketChange = async (t) => {
        setTicket(t);
        setQuantity(minQuantity);
        trackViewItem(t);
        await promoActions.onTicketSelected(t);
    }

    const incrementQuantity = () => setQuantity(quantity + 1);

    const decrementQuantity = () => setQuantity(quantity - 1);

    const handleApplyPromoCode = async (code) => {
        // If the user applies the suggested/discovered code while a
        // non-qualifying ticket is selected, deselect first. The qualifying
        // ticket may not yet be in originalTicketTypes (it's revealed by the
        // code-filtered refetch inside applyPromoCode). After apply resolves,
        // the post-apply effect picks the qualifying ticket from the
        // refreshed list. Manual non-discovered codes still validate against
        // the current ticket — backend decides.
        const isDiscovered = code === promoState.suggestedCode;
        const isValid = promoState.isCodeValidForTicket;
        let targetTicket = ticket;
        if (isDiscovered && isValid && ticket && !isValid(ticket)) {
            setTicket(null);
            setQuantity(minQuantity);
            targetTicket = null;
        }
        catalogBeforeApply.current = new Set(allowedTicketTypes.map(t => t.id));

        await promoActions.onApply(code, targetTicket, quantity);
    }

    return (
        <div className={`${styles.outerWrapper} step-wrapper`}>
            <>
                <div className={styles.innerWrapper}>
                    <div className={styles.title} >
                        <span style={isActive ? { display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' } : {}}>
                            <span>Ticket</span>
                            {isActive && showMultipleTicketTexts &&
                                <a className={styles.moreInfo} data-tip data-for="ticket-quantity-info" style={{ margin: 0 }}>
                                    <i className="glyphicon glyphicon-info-sign" aria-hidden="true" />{` `}
                                    Need multiple ticket types?
                                </a>
                            }
                        </span>
                        <div className={styles.summary}>
                            <span>
                                {!isActive && ticket && (
                                    <>
                                        {`${ticket.name} (${quantity}): `}
                                        <>
                                            {getTicketCost(ticket, quantity)}
                                        </>
                                        {`${getTicketTaxes(ticket, taxTypes)}`}

                                        {!isActive && reservation?.discount_amount > 0 && (
                                            <>
                                                <br />
                                                <span className={styles.promoCode}>
                                                    Promo code&nbsp;<abbr title={reservation.promo_code}>{reservation.promo_code}</abbr>&nbsp;applied:
                                                </span>
                                                {!isPrePaidReservation &&
                                                    <span className={styles.discount}>
                                                        {` - ${formatCurrency(reservation.discount_amount, { currency: ticket.currency })} ${ticket.currency}`}
                                                    </span>
                                                }
                                            </>
                                        )}

                                        {!isActive && reservation && !isPrePaidReservation && (
                                            <span className={styles.promo}>
                                                Subtotal: {`${ticket?.currency_symbol} ${((reservation?.raw_amount_in_cents - reservation?.discount_amount_in_cents) / 100).toFixed(2)} ${ticket?.currency}`}
                                            </span>
                                        )}

                                        {!isActive && reservation?.taxes_amount > 0 && !isPrePaidReservation && (
                                            <>
                                                {reservation?.applied_taxes.map((tax) => {
                                                    return (
                                                        <React.Fragment key={tax.id}>
                                                            <span className={styles.taxes}>
                                                                <abbr title={tax.name}>
                                                                    {tax.name}
                                                                </abbr>
                                                                {` : ${formatCurrency(tax.amount, { currency: ticket.currency })} ${ticket.currency}`}
                                                            </span>
                                                            <br />
                                                        </React.Fragment>
                                                    )
                                                })}
                                            </>
                                        )}
                                        {!isActive && reservation && !isPrePaidReservation && (
                                            <>
                                                <br />
                                                Total: {`${formatCurrency(reservation.amount, { currency: ticket.currency })} ${ticket.currency}`}
                                            </>
                                        )}
                                    </>
                                )}

                            </span>
                        </div>
                    </div>

                    <animated.div style={{ overflow: 'hidden', ...toggleAnimation }}>
                        <div ref={ref}>
                            {showTicketSelector && (
                                <div className={styles.form}>
                                    <div className={styles.dropdown}>
                                        <TicketDropdownComponent selectedTicket={ticket}
                                            ticketTypes={allowedTicketTypes}
                                            taxTypes={taxTypes}
                                            onTicketSelect={handleTicketChange}
                                        />
                                    </div>

                                    {ticket && (
                                        <>
                                            <div className={styles.quantity}>
                                                <div className="input-group">
                                                    <span className="input-group-btn">
                                                        <button aria-label="remove a ticket" className="btn btn-default" onClick={decrementQuantity} disabled={maxQuantity === 0 || quantity === minQuantity}>
                                                            <i className="fa fa-minus"></i>
                                                        </button>
                                                    </span>
                                                    <input className="form-control" aria-label="ticket quanity" name="ticket_quantity" type="text" value={quantity} readOnly={true} disabled={maxQuantity === 0} />
                                                    <span className="input-group-btn">
                                                        <button aria-label="add a ticket" className="btn btn-default" onClick={incrementQuantity} disabled={maxQuantity === 0 || quantity >= maxQuantity}>
                                                            <i className="fa fa-plus" />
                                                        </button>
                                                    </span>
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}
                            {!showTicketSelector && (
                                <TicketNotice
                                    message={noAllowedTicketsMessage || T.translate("ticket_type.no_tickets_available")}
                                    variant="info"
                                    html={!!noAllowedTicketsMessage}
                                />
                            )}
                            <ReactTooltip id="ticket-quantity-info" place="bottom" overridePosition={avoidTooltipOverflow}>
                                <div className={styles.moreInfoTooltip}>
                                    {T.translate("ticket_type.ticket_quantity_tooltip")}
                                </div>
                            </ReactTooltip>

                            {allowPromoCodes &&
                                <>
                                    <PromoCodeInput
                                        promoStatus={promoState.status}
                                        promoCode={promoCode}
                                        suggestedCode={promoState.suggestedCode}
                                        isAutoApplied={promoState.isAutoApplied}
                                        isCurrentTicketQualifying={promoState.isCodeValidForTicket(ticket)}
                                        onInputChange={promoActions.onInputChange}
                                        onApply={handleApplyPromoCode}
                                        onRemove={promoActions.onRemove}
                                        showMultipleTicketTexts={showMultipleTicketTexts} />
                                </>
                            }
                            <TicketNotice message={validationError} variant="error" />
                            <TicketNotice message={infoMessage} variant="info" />
                        </div>
                    </animated.div>

                    {inPersonDisclaimer && ticket && isInPersonTicketType(ticket) &&
                        <div className={styles.inPersonDisclaimer}>
                            <RawHTML>
                                {inPersonDisclaimer}
                            </RawHTML>
                        </div>
                    }
                </div>
            </>
        </div>
    );
}


export default TicketTypeComponent
