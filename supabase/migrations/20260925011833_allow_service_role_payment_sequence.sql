-- Checkout inserts use service_role; customers must not allocate payment folios.
grant usage on sequence private.payment_sequence to service_role;
