-- CreateIndex
CREATE INDEX "trip_stop_station_id_departure_at_idx" ON "trip_stop"("station_id", "departure_at");
