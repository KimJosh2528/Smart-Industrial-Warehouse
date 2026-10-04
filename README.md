# Smart Industrial Warehouse Access & Safety System

Final project foundation for a React/Next.js dashboard, Supabase backend, and reusable ESP32 demonstration hardware.

## Purpose

The system models warehouse access control and safety monitoring for six logical locations:

- Truck Entrance
- Staff Entrance
- Staff Room 1
- Staff Room 2
- Staff Room 3
- Staff Room 4

The physical prototype reuses a limited ESP32/ESP32-CAM, RFID reader, keypad, DHT22, smoke sensor, three servos, buzzer, and LCD during demonstrations. The database and dashboard represent the complete logical warehouse.

## Technology stack

- Next.js, React, TypeScript, and Tailwind CSS
- Supabase PostgreSQL, Auth, Row Level Security, and Edge Functions
- ESP32 and ESP32-CAM firmware

## Current phase

Phase 1 — project foundation. The database schema, authentication, device protocol, access logic, safety logic, and dashboard features have not been implemented yet.

## Scope exclusions

This project does not include PHP, XAMPP, PIR, ultrasonic, fingerprint, or a separate fire-exit servo.

## Development

The dashboard is in `dashboard/`. Supabase Edge Functions and migrations will be added in later phases. Firmware will be added in `firmware/` after the communication design is approved.
