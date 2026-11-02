-- CreateIndex
CREATE INDEX "booking_status_deadline_at_idx" ON "booking"("status", "deadline_at");

-- CreateIndex
CREATE INDEX "booking_contact_phone_e164_status_idx" ON "booking"("contact_phone_e164", "status");
