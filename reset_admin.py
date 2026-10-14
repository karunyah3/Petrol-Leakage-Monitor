"""
Admin Reset Utility for Two-Zone Petrol Leakage Monitoring System
Allows resetting the administrator credentials or triggering the setup page.
"""
import sys
import os
from werkzeug.security import generate_password_hash
import database

def show_menu():
    print("=" * 65)
    print("  PETROL LEAKAGE MONITOR — ADMIN CREDENTIAL MANAGER")
    print("=" * 65)
    print("1. Clear all users (next browser visit will show Setup Page)")
    print("2. Set default demo credentials (username: admin, password: admin123)")
    print("3. Create a custom user account directly")
    print("4. List existing users")
    print("5. Exit")
    print("=" * 65)

def clear_users():
    conn = database.get_db_connection()
    c = conn.cursor()
    c.execute("DELETE FROM users")
    conn.commit()
    conn.close()
    print("\n[SUCCESS] All users have been cleared.")
    print("Opening http://127.0.0.1:5000 in your browser will now show the")
    print("'First-Time Setup' screen to create your new username & password.\n")

def set_default():
    conn = database.get_db_connection()
    c = conn.cursor()
    c.execute("DELETE FROM users")
    conn.commit()
    conn.close()
    
    hashed = generate_password_hash("admin123")
    database.create_user("admin", hashed, is_admin=1)
    print("\n[SUCCESS] Default admin account restored:")
    print("  Username: admin")
    print("  Password: admin123\n")

def create_custom():
    username = input("Enter new username: ").strip()
    if len(username) < 3:
        print("[ERROR] Username must be at least 3 characters.")
        return
    password = input("Enter new password: ").strip()
    if len(password) < 6:
        print("[ERROR] Password must be at least 6 characters.")
        return
    hashed = generate_password_hash(password)
    success = database.create_user(username, hashed, is_admin=1)
    if success:
        print(f"\n[SUCCESS] Created administrator account '{username}'.")
    else:
        print(f"\n[ERROR] Failed to create user '{username}'.")

def list_users():
    conn = database.get_db_connection()
    c = conn.cursor()
    c.execute("SELECT id, username, is_admin, created_at FROM users")
    rows = c.fetchall()
    conn.close()
    if not rows:
        print("\nNo users exist in the database (Setup mode is ACTIVE).")
    else:
        print("\nCurrent Users:")
        for r in rows:
            role = "Admin" if r["is_admin"] else "User"
            print(f" - ID: {r['id']} | Username: {r['username']} ({role}) | Created: {r['created_at']}")
    print()

def main():
    database.init_db()
    
    if len(sys.argv) > 1:
        arg = sys.argv[1].lower()
        if arg in ["--clear", "-c", "clear"]:
            clear_users()
            return
        elif arg in ["--default", "-d", "default"]:
            set_default()
            return
        elif arg in ["--list", "-l", "list"]:
            list_users()
            return

    show_menu()
    choice = input("Select an option (1-5): ").strip()
    if choice == "1":
        clear_users()
    elif choice == "2":
        set_default()
    elif choice == "3":
        create_custom()
    elif choice == "4":
        list_users()
    elif choice == "5":
        print("Exiting.")
    else:
        print("Invalid option.")

if __name__ == "__main__":
    main()
