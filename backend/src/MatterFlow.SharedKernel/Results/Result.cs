namespace MatterFlow.SharedKernel.Results;

/// <summary>Outcome of an operation without a value.</summary>
public class Result
{
    protected Result(Error? error) => Error = error;

    public bool IsSuccess => Error is null;

    public bool IsFailure => Error is not null;

    /// <summary>The failure; null on success.</summary>
    public Error? Error { get; }

    public static Result Success() => new(null);

    public static Result Failure(Error error) => new(error ?? throw new ArgumentNullException(nameof(error)));

    public static implicit operator Result(Error error) => Failure(error);
}

/// <summary>Outcome of an operation that yields <typeparamref name="T"/> on success.</summary>
public sealed class Result<T> : Result
{
    private readonly T? _value;

    private Result(T? value, Error? error)
        : base(error) => _value = value;

    /// <summary>The value; throws if the result is a failure.</summary>
    public T Value => IsSuccess ? _value! : throw new InvalidOperationException("Cannot read Value of a failed result.");

    public static Result<T> Success(T value) => new(value, null);

    public static new Result<T> Failure(Error error) => new(default, error ?? throw new ArgumentNullException(nameof(error)));

    public static implicit operator Result<T>(T value) => Success(value);

    public static implicit operator Result<T>(Error error) => Failure(error);

    public TOut Match<TOut>(Func<T, TOut> onSuccess, Func<Error, TOut> onFailure) =>
        IsSuccess ? onSuccess(_value!) : onFailure(Error!);

    public Result<TOut> Map<TOut>(Func<T, TOut> map) =>
        IsSuccess ? Result<TOut>.Success(map(_value!)) : Result<TOut>.Failure(Error!);
}
