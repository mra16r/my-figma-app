type Props = {
  ready: boolean;
  error?: string;
  onSignIn: () => void;
};

export default function SignInScreen({ ready, error, onSignIn }: Props) {
  return (
    <div className="screen">
      <div className="card">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={40} height={40} />
        <h1>My Figma App</h1>
        <p>Your boards are saved in your Google Drive, in a folder this app creates. It can't see anything else in your Drive.</p>
        <button type="button" className="primary" data-signin onClick={onSignIn} disabled={!ready}>
          {ready ? "Sign in with Google" : "Loading…"}
        </button>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
