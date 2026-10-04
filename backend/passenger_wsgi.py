"""Passenger loader. Do not make this file import itself.

cPanel sometimes generates a passenger_wsgi.py that load_source()s
passenger_wsgi.py again. That deadlocks and the site never responds.
Point the startup file at wsgi_app.py, or keep this one-line re-export.
"""
from wsgi_app import application
