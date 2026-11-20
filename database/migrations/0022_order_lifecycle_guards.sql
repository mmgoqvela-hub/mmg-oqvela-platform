-- MMG OQVELA
-- Migration 0022: Enforce order/payment lifecycle invariants in D1 itself.
-- These guards protect the workflow even if a future route or internal task
-- updates store_orders without using the current HTTP transition validator.

CREATE TRIGGER trg_store_order_status_transition_guard
BEFORE UPDATE OF order_status ON store_orders
WHEN OLD.order_status != NEW.order_status
 AND NOT (
   (OLD.order_status = 'pending' AND NEW.order_status IN ('confirmed','cancelled'))
   OR (OLD.order_status = 'confirmed' AND NEW.order_status IN ('processing','cancelled'))
   OR (OLD.order_status = 'processing' AND NEW.order_status IN ('shipped','completed','cancelled'))
   OR (OLD.order_status = 'shipped' AND NEW.order_status = 'completed')
 )
BEGIN
  SELECT RAISE(ABORT, 'Invalid order status transition');
END;

CREATE TRIGGER trg_store_payment_status_transition_guard
BEFORE UPDATE OF payment_status ON store_orders
WHEN OLD.payment_status != NEW.payment_status
 AND NOT (
   (OLD.payment_status = 'unpaid' AND NEW.payment_status = 'paid')
   OR (OLD.payment_status = 'pending' AND NEW.payment_status = 'paid')
   OR (OLD.payment_status = 'pending' AND NEW.payment_status = 'rejected'
       AND OLD.payment_method = 'shamcash')
   OR (OLD.payment_status = 'paid' AND NEW.payment_status = 'refunded'
       AND NEW.order_status = 'cancelled')
 )
BEGIN
  SELECT RAISE(ABORT, 'Invalid payment status transition');
END;

CREATE TRIGGER trg_store_order_payment_consistency_guard
BEFORE UPDATE OF order_status, payment_status ON store_orders
WHEN
  (NEW.order_status = 'completed' AND NEW.payment_status != 'paid')
  OR (NEW.payment_method = 'shamcash'
      AND NEW.order_status IN ('confirmed','processing','shipped','completed')
      AND NEW.payment_status != 'paid')
  OR (NEW.payment_status = 'refunded' AND NEW.order_status != 'cancelled')
BEGIN
  SELECT RAISE(ABORT, 'Order status and payment status are inconsistent');
END;
