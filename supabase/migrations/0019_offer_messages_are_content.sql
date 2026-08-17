-- chat_message_content_ck required body, storage_path, or kind='system' — so a
-- structured offer, which carries only a price, was rejected.
--
-- An offer IS content: the client renders "20 ₼ təklif edildi" from the number.
-- Requiring a duplicated body alongside it would put the price in two places
-- that can disagree, which is worse than widening the check.
--
-- Also adds the constraint that was missing in the other direction: an offer
-- must actually have a price. Nothing previously stopped kind='offer' with a
-- null offer_price_minor, which would render as an empty bubble.
alter table public.chat_message
  drop constraint if exists chat_message_content_ck;

alter table public.chat_message
  add constraint chat_message_content_ck check (
    body is not null
    or storage_path is not null
    or kind = 'system'
    or (kind = 'offer' and offer_price_minor is not null)
  );

alter table public.chat_message
  add constraint chat_message_offer_ck check (
    kind <> 'offer' or offer_price_minor is not null
  );
