"use strict";
import React from 'react';

const pageTitle: React.FC = () => (
  <h1 className="title">
{"Claims Registration System"}
  </h1>
);
const navLinks: React.FC = () => (
  <nav className="nav"></nav>
);
const claimsHeader: React.FC = () => (
  <header className="header">
    <h1 className="title">
{"Claims Registration System"}
    </h1>
    <nav className="nav"></nav>
  </header>
);
const statTotal: React.FC = () => (
  <div className="stat-card">
    <span className="stat-label">
{"Total"}
    </span>
    <span className="stat-value">
{"0"}
    </span>
  </div>
);
const statPending: React.FC = () => (
  <div className="stat-card">
    <span className="stat-label">
{"Pending"}
    </span>
    <span className="stat-value">
{"0"}
    </span>
  </div>
);
const statApproved: React.FC = () => (
  <div className="stat-card">
    <span className="stat-label">
{"Approved"}
    </span>
    <span className="stat-value">
{"0"}
    </span>
  </div>
);
const statAmount: React.FC = () => (
  <div className="stat-card">
    <span className="stat-label">
{"Total Amount"}
    </span>
    <span className="stat-value">
{"$0.00"}
    </span>
  </div>
);
const statsBar: React.FC = () => (
  <div className="stats-bar">
    <div className="stat-card">
      <span className="stat-label">
{"Total"}
      </span>
      <span className="stat-value">
{"0"}
      </span>
    </div>
    <div className="stat-card">
      <span className="stat-label">
{"Pending"}
      </span>
      <span className="stat-value">
{"0"}
      </span>
    </div>
    <div className="stat-card">
      <span className="stat-label">
{"Approved"}
      </span>
      <span className="stat-value">
{"0"}
      </span>
    </div>
    <div className="stat-card">
      <span className="stat-label">
{"Total Amount"}
      </span>
      <span className="stat-value">
{"$0.00"}
      </span>
    </div>
  </div>
);
const titleField: React.FC = () => (
  <div className="form-group">
    <label htmlFor="title">
{"Claim Title"}
    </label>
    <input type="text" name="title" id="title" className="input" required="required" />
  </div>
);
const categoryField: React.FC = () => (
  <div className="form-group">
    <label htmlFor="category">
{"Category"}
    </label>
    <select name="category" id="category" className="input">
      <option value="property">
{"Property"}
      </option>
      <option value="health">
{"Health"}
      </option>
      <option value="auto">
{"Auto"}
      </option>
      <option value="liability">
{"Liability"}
      </option>
    </select>
  </div>
);
const claimantField: React.FC = () => (
  <div className="form-group">
    <label htmlFor="claimant">
{"Claimant Name"}
    </label>
    <input type="text" name="claimant" id="claimant" className="input" required="required" />
  </div>
);
const emailField: React.FC = () => (
  <div className="form-group">
    <label htmlFor="email">
{"Email"}
    </label>
    <input type="email" name="email" id="email" className="input" required="required" />
  </div>
);
const amountField: React.FC = () => (
  <div className="form-group">
    <label htmlFor="amount">
{"Amount"}
    </label>
    <input type="number" name="amount" id="amount" className="input" min="0" step="0.01" required="required" />
  </div>
);
const submitButton: React.FC = () => (
  <button type="submit" className="btn-primary">
{"Submit Claim"}
  </button>
);
const claimForm: React.FC = () => (
  <form className="form-section">
    <h2 className="form-title">
{"New Claim"}
    </h2>
    <div className="form-group">
      <label htmlFor="title">
{"Claim Title"}
      </label>
      <input type="text" name="title" id="title" className="input" required="required" />
    </div>
    <div className="form-group">
      <label htmlFor="category">
{"Category"}
      </label>
      <select name="category" id="category" className="input">
        <option value="property">
{"Property"}
        </option>
        <option value="health">
{"Health"}
        </option>
        <option value="auto">
{"Auto"}
        </option>
        <option value="liability">
{"Liability"}
        </option>
      </select>
    </div>
    <div className="form-group">
      <label htmlFor="claimant">
{"Claimant Name"}
      </label>
      <input type="text" name="claimant" id="claimant" className="input" required="required" />
    </div>
    <div className="form-group">
      <label htmlFor="email">
{"Email"}
      </label>
      <input type="email" name="email" id="email" className="input" required="required" />
    </div>
    <div className="form-group">
      <label htmlFor="amount">
{"Amount"}
      </label>
      <input type="number" name="amount" id="amount" className="input" min="0" step="0.01" required="required" />
    </div>
    <button type="submit" className="btn-primary">
{"Submit Claim"}
    </button>
  </form>
);
const tableHead: React.FC = () => (
  <thead>
    <tr>
      <th>
{"ID"}
      </th>
      <th>
{"Title"}
      </th>
      <th>
{"Category"}
      </th>
      <th>
{"Claimant"}
      </th>
      <th>
{"Amount"}
      </th>
      <th>
{"Status"}
      </th>
    </tr>
  </thead>
);
const tableBody: React.FC = () => (
  <tbody className="claims-body"></tbody>
);
const claimsTable: React.FC = () => (
  <table className="table">
    <thead>
      <tr>
        <th>
{"ID"}
        </th>
        <th>
{"Title"}
        </th>
        <th>
{"Category"}
        </th>
        <th>
{"Claimant"}
        </th>
        <th>
{"Amount"}
        </th>
        <th>
{"Status"}
        </th>
      </tr>
    </thead>
    <tbody className="claims-body"></tbody>
  </table>
);
const tableSection: React.FC = () => (
  <section className="table-section">
    <h2 className="section-title">
{"Claims"}
    </h2>
    <table className="table">
      <thead>
        <tr>
          <th>
{"ID"}
          </th>
          <th>
{"Title"}
          </th>
          <th>
{"Category"}
          </th>
          <th>
{"Claimant"}
          </th>
          <th>
{"Amount"}
          </th>
          <th>
{"Status"}
          </th>
        </tr>
      </thead>
      <tbody className="claims-body"></tbody>
    </table>
  </section>
);
const claimsPage: React.FC = () => (
  <div className="container">
    <header className="header">
      <h1 className="title">
{"Claims Registration System"}
      </h1>
      <nav className="nav"></nav>
    </header>
    <div className="stats-bar">
      <div className="stat-card">
        <span className="stat-label">
{"Total"}
        </span>
        <span className="stat-value">
{"0"}
        </span>
      </div>
      <div className="stat-card">
        <span className="stat-label">
{"Pending"}
        </span>
        <span className="stat-value">
{"0"}
        </span>
      </div>
      <div className="stat-card">
        <span className="stat-label">
{"Approved"}
        </span>
        <span className="stat-value">
{"0"}
        </span>
      </div>
      <div className="stat-card">
        <span className="stat-label">
{"Total Amount"}
        </span>
        <span className="stat-value">
{"$0.00"}
        </span>
      </div>
    </div>
    <form className="form-section">
      <h2 className="form-title">
{"New Claim"}
      </h2>
      <div className="form-group">
        <label htmlFor="title">
{"Claim Title"}
        </label>
        <input type="text" name="title" id="title" className="input" required="required" />
      </div>
      <div className="form-group">
        <label htmlFor="category">
{"Category"}
        </label>
        <select name="category" id="category" className="input">
          <option value="property">
{"Property"}
          </option>
          <option value="health">
{"Health"}
          </option>
          <option value="auto">
{"Auto"}
          </option>
          <option value="liability">
{"Liability"}
          </option>
        </select>
      </div>
      <div className="form-group">
        <label htmlFor="claimant">
{"Claimant Name"}
        </label>
        <input type="text" name="claimant" id="claimant" className="input" required="required" />
      </div>
      <div className="form-group">
        <label htmlFor="email">
{"Email"}
        </label>
        <input type="email" name="email" id="email" className="input" required="required" />
      </div>
      <div className="form-group">
        <label htmlFor="amount">
{"Amount"}
        </label>
        <input type="number" name="amount" id="amount" className="input" min="0" step="0.01" required="required" />
      </div>
      <button type="submit" className="btn-primary">
{"Submit Claim"}
      </button>
    </form>
    <section className="table-section">
      <h2 className="section-title">
{"Claims"}
      </h2>
      <table className="table">
        <thead>
          <tr>
            <th>
{"ID"}
            </th>
            <th>
{"Title"}
            </th>
            <th>
{"Category"}
            </th>
            <th>
{"Claimant"}
            </th>
            <th>
{"Amount"}
            </th>
            <th>
{"Status"}
            </th>
          </tr>
        </thead>
        <tbody className="claims-body"></tbody>
      </table>
    </section>
  </div>
);
